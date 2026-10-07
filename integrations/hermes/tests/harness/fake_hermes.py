# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""A fake Hermes plugin host for CI. It is NOT hermes-agent; it implements only the surface the
plugin uses, with the semantics copied from the Hermes source (commit 65bc6727 of
github.com/NousResearch/hermes-agent). Each behaviour names its source file.

Not covered (verify against a real Hermes in a nightly job or by hand): the real plugin discovery
and enable flow, MCP transport and auth, the real tool loop, and whether hooks also fire inside
delegated subagents.
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import re
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# hermes_cli/plugins.py: VALID_HOOKS (the subset relevant here; the real set is larger).
VALID_HOOKS = {
    "pre_tool_call",
    "post_tool_call",
    "pre_llm_call",
    "post_llm_call",
    "on_session_start",
    "on_session_end",
    "kanban_task_completed",
}
# hermes_cli/plugins_dispatch.py: SYSTEM_PROMPT_SECTION_POSITIONS, *_MAX_CHARS.
SYSTEM_PROMPT_SECTION_POSITIONS = {"after_memory"}
MAX_SYSTEM_PROMPT_SECTION_CHARS = 4000
_SECTION_ID_RE = re.compile(r"^[a-z0-9._-]{1,128}$")
# hermes_cli/plugins.py: PluginContext._MCP_RESULT_CHAR_CAP.
MCP_RESULT_CHAR_CAP = 65536
# website/docs/user-guide/features/hooks.md: plugins.hook_callback_timeout (default 30 s) bounds
# pre_tool_call; a timeout fails closed. The fake cannot interrupt a callback, so it exposes the
# value for tests that check the plugin keeps its own budget below it.
HOOK_CALLBACK_TIMEOUT_SECONDS = 30


class FakeMcpTransport:
    """What Hermes' MCP client does behind ``call_mcp``: ``handle(tool, arguments)`` returns
    ``(text, structured_or_None)`` or raises ``McpToolError``; connection failures raise
    ``ConnectionError`` or are returned as an error envelope, as Hermes does for a server that
    is not connected (tools/mcp_tool_handlers.py: tool_error(\"MCP server '...' is not connected\"))."""

    def handle(self, tool: str, arguments: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:  # pragma: no cover
        raise NotImplementedError


class McpToolError(Exception):
    pass


def _mcp_envelope(raw: Any) -> dict[str, Any]:
    """hermes_cli/plugins.py: PluginContext._mcp_envelope, copied."""
    if not isinstance(raw, str):
        raw = "" if raw is None else str(raw)
    truncated = len(raw) > MCP_RESULT_CHAR_CAP
    if truncated:
        raw = raw[:MCP_RESULT_CHAR_CAP] + "… [truncated]"
    try:
        parsed: Any = json.loads(raw)
    except (ValueError, TypeError):
        parsed = None
    if isinstance(parsed, dict) and "error" in parsed:
        envelope: dict[str, Any] = {"ok": False, "error": parsed["error"]}
    elif isinstance(parsed, dict) and "result" in parsed:
        envelope = {"ok": True, "result": parsed["result"]}
        if "structuredContent" in parsed:
            envelope["structuredContent"] = parsed["structuredContent"]
    else:
        envelope = {"ok": True, "result": parsed if parsed is not None else raw}
    return {**envelope, "truncated": True} if truncated else envelope


@dataclass
class ToolDecision:
    """The outcome of ``pre_tool_call`` for one call: blocked (message) or proceed with ``args``
    (possibly rewritten). Mirrors hermes_cli/plugins.py ``_get_pre_tool_call_directive_details``
    and model_tools.py ``_pre_dispatch_guards``."""

    blocked: bool
    message: str | None
    args: dict[str, Any]
    modified: bool = False


@dataclass
class FakeCtx:
    """The PluginContext surface the plugin uses (hermes_cli/plugins.py)."""

    plugin_id: str
    host: FakeHermes
    hooks: dict[str, list[Callable[..., Any]]] = field(default_factory=dict)
    tools: dict[str, dict[str, Any]] = field(default_factory=dict)
    sections: dict[str, dict[str, Any]] = field(default_factory=dict)
    skills: dict[str, dict[str, Any]] = field(default_factory=dict)
    mcp_calls: list[tuple[str, str, dict[str, Any], float]] = field(default_factory=list)

    # register_hook: unknown names warn but are still stored (the real one logs a warning).
    def register_hook(self, hook_name: str, callback: Callable[..., Any]) -> None:
        self.hooks.setdefault(hook_name, []).append(callback)
        self.host.unknown_hooks.update({hook_name} - VALID_HOOKS)

    def register_tool(self, name: str, toolset: str, schema: dict, handler: Callable, **kwargs: Any) -> None:
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler, **kwargs}

    # register_system_prompt_section: hermes_cli/plugins.py, validations as in the real method.
    def register_system_prompt_section(
        self, id: str, content: Any, *, position: str = "after_memory", max_chars: int = 4000
    ) -> None:
        if not _SECTION_ID_RE.match(id):
            raise ValueError(
                "system prompt section id must be 1-128 lowercase characters using letters, numbers, '.', '_', or '-'"
            )
        if not isinstance(content, str) and not callable(content):
            raise TypeError("system prompt section content must be a string or callable")
        if position not in SYSTEM_PROMPT_SECTION_POSITIONS:
            raise ValueError(
                "system prompt section position must be one of: " + ", ".join(sorted(SYSTEM_PROMPT_SECTION_POSITIONS))
            )
        if (
            isinstance(max_chars, bool)
            or not isinstance(max_chars, int)
            or not 0 < max_chars <= MAX_SYSTEM_PROMPT_SECTION_CHARS
        ):
            raise ValueError(f"system prompt section max_chars must be between 1 and {MAX_SYSTEM_PROMPT_SECTION_CHARS}")
        if id in self.sections:
            raise ValueError(f"system prompt section {id!r} is already registered")
        text = content if isinstance(content, str) else content({})
        if len(text) > max_chars:
            raise ValueError(f"section {id!r} exceeds max_chars ({len(text)} > {max_chars})")
        self.sections[id] = {"content": text, "position": position, "max_chars": max_chars}

    # register_skill: hermes_cli/plugins_content.py; name must match [a-zA-Z0-9_-]+, file must exist.
    def register_skill(self, name: str, path: Path, description: str = "", frontmatter: Any = None) -> None:
        if ":" in name or not re.match(r"^[a-zA-Z0-9_-]+$", name):
            raise ValueError(f"Invalid skill name '{name}'")
        if not Path(path).exists():
            raise FileNotFoundError(f"SKILL.md not found at {path}")
        self.skills[f"{self.plugin_id}:{name}"] = {"path": Path(path), "description": description}

    # get_config: plugins.entries.<plugin_id>.settings.<key> (hermes_cli/plugins.py: get_config).
    def get_config(self, key: str, default: Any = None) -> Any:
        return self.host.settings.get(key, default)

    # call_mcp: hermes_cli/plugins.py: PluginContext.call_mcp (allowlist, timeout clamp, envelope).
    def call_mcp(
        self, server: str, tool: str, arguments: dict[str, Any] | None = None, timeout: float = 30
    ) -> dict[str, Any]:
        if server not in self.host.mcp_allowlist:
            raise PermissionError(
                f"Plugin {self.plugin_id!r} is not allowed to call MCP server {server!r}. Add it to "
                f"plugins.entries.{self.plugin_id}.mcp_allowlist in config.yaml to grant access "
                "(default is no MCP access)."
            )
        try:
            timeout = float(timeout)
        except (TypeError, ValueError):
            timeout = 30.0
        timeout = max(1.0, min(timeout, 600.0))
        arguments = dict(arguments or {})
        self.mcp_calls.append((server, tool, json.loads(json.dumps(arguments)), timeout))
        transport = self.host.transport
        try:
            text, structured = transport.handle(tool, arguments)
        except McpToolError as exc:
            return _mcp_envelope(json.dumps({"error": str(exc)}))
        except ConnectionError as exc:
            if self.host.connection_failure == "raise":
                raise
            return _mcp_envelope(json.dumps({"error": f"MCP server '{server}' is not connected ({exc})"}))
        payload: dict[str, Any] = {"result": text}
        if structured is not None and self.host.structured_content:
            payload["structuredContent"] = structured
        return _mcp_envelope(json.dumps(payload))


def _accepted(callback: Callable[..., Any], kwargs: dict[str, Any]) -> dict[str, Any]:
    """Signature filtering: a callback with **kwargs gets the whole payload, a legacy one only the
    fields it declares (website/docs/developer-guide/plugins/index.md, compatibility contract)."""
    params = inspect.signature(callback).parameters
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return kwargs
    return {k: v for k, v in kwargs.items() if k in params}


class FakeHermes:
    """Loads the plugin like Hermes does and fires hooks with realistic payloads."""

    def __init__(
        self,
        plugin_dir: Path,
        *,
        settings: dict[str, Any],
        transport: FakeMcpTransport,
        mcp_allowlist: list[str] | None = None,
        structured_content: bool = True,
        connection_failure: str = "envelope",
    ) -> None:
        self.plugin_dir = Path(plugin_dir)
        self.settings = settings
        self.transport = transport
        self.mcp_allowlist = ["worldbuilder"] if mcp_allowlist is None else mcp_allowlist
        self.structured_content = structured_content
        self.connection_failure = connection_failure
        self.unknown_hooks: set[str] = set()
        self.ctx = FakeCtx(plugin_id=self.plugin_dir.name, host=self)
        self._turn = 0
        self._lock = threading.Lock()

    # hermes_cli/plugins_loader.py: spec_from_file_location(module_name, init_file,
    # submodule_search_locations=[plugin_dir]) so that relative imports inside the plugin work.
    def load(self) -> FakeHermes:
        manifest_path = self.plugin_dir / "plugin.yaml"
        assert manifest_path.is_file(), "plugin.yaml missing"
        module_name = "hermes_plugins." + re.sub(r"\W", "_", self.plugin_dir.name)
        for name in [m for m in sys.modules if m == module_name or m.startswith(module_name + ".")]:
            del sys.modules[name]
        spec = importlib.util.spec_from_file_location(
            module_name, self.plugin_dir / "__init__.py", submodule_search_locations=[str(self.plugin_dir)]
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        module.register(self.ctx)
        return self

    # --- hooks --------------------------------------------------------------------------

    def _invoke(self, hook: str, **kwargs: Any) -> list[Any]:
        """hermes_cli/lifecycle invoke_hook: every callback runs, in registration order; an
        exception is isolated (logged) and yields no result, except for pre_tool_call where it
        fails closed (hooks.md: "A callback that raises ... the block message names the callback
        and the error")."""
        results = []
        for callback in self.ctx.hooks.get(hook, []):
            try:
                results.append(callback(**_accepted(callback, kwargs)))
            except Exception as exc:
                if hook == "pre_tool_call":
                    results.append(
                        {
                            "action": "block",
                            "message": f"pre_tool_call callback {callback.__name__} raised {type(exc).__name__}: {exc}",
                        }
                    )
        return results

    def pre_llm_call(
        self,
        *,
        session_id: str = "session-1",
        user_message: Any = "",
        is_first_turn: bool = True,
        conversation_history: list[dict[str, Any]] | None = None,
        model: str = "test/model",
        platform: str = "cli",
    ) -> str | None:
        """Payload of website/docs/user-guide/features/hooks.md, ``pre_llm_call`` (session_id,
        user_message, conversation_history, is_first_turn, model, platform). Returned dicts with a
        ``context`` key and plain strings are joined with a blank line; the real Hermes appends the
        text to the user message of the turn."""
        history = list(conversation_history or [])
        history.append({"role": "user", "content": user_message})
        results = self._invoke(
            "pre_llm_call",
            session_id=session_id,
            user_message=user_message,
            conversation_history=history,
            is_first_turn=is_first_turn,
            model=model,
            platform=platform,
        )
        texts = []
        for result in results:
            if isinstance(result, dict) and isinstance(result.get("context"), str) and result["context"]:
                texts.append(result["context"])
            elif isinstance(result, str) and result:
                texts.append(result)
        return "\n\n".join(texts) if texts else None

    def pre_tool_call(
        self,
        tool_name: str,
        args: dict[str, Any],
        *,
        session_id: str = "session-1",
        task_id: str | None = None,
    ) -> ToolDecision:
        """Payload of hooks.md ``pre_tool_call`` (tool_name, args, task_id, session_id,
        tool_call_id, turn_id, api_request_id, middleware_trace); aggregation as in
        hermes_cli/plugins.py ``_get_pre_tool_call_directive_details``: ``modify`` args are
        shallow-merged over the original args (only non-empty dicts count), a valid ``block`` wins
        over everything and needs a message."""
        with self._lock:
            self._turn += 1
            turn = self._turn
        original = json.loads(json.dumps(args))
        results = self._invoke(
            "pre_tool_call",
            tool_name=tool_name,
            args=json.loads(json.dumps(args)),
            task_id=session_id if task_id is None else task_id,
            session_id=session_id,
            tool_call_id=f"call_{turn}",
            turn_id=f"turn_{turn}",
            api_request_id=f"req_{turn}",
            middleware_trace=[],
        )
        modified: dict[str, Any] | None = None
        for result in results:
            if not isinstance(result, dict):
                continue
            action = result.get("action")
            if action == "modify":
                partial = result.get("args")
                if isinstance(partial, dict) and partial:
                    modified = {**(modified if modified is not None else original), **partial}
                continue
            if action == "block":
                message = result.get("message")
                if isinstance(message, str) and message:
                    return ToolDecision(
                        True, message, modified if modified is not None else original, modified is not None
                    )
        final = modified if modified is not None else original
        return ToolDecision(False, None, final, modified is not None)

    def post_tool_call(
        self,
        tool_name: str,
        args: dict[str, Any],
        result: str,
        *,
        session_id: str = "session-1",
        task_id: str | None = None,
    ) -> None:
        """hooks.md ``post_tool_call``: ``result`` is always a JSON string; observer, return ignored."""
        self._invoke(
            "post_tool_call",
            tool_name=tool_name,
            args=args,
            result=result,
            task_id=session_id if task_id is None else task_id,
            session_id=session_id,
            duration_ms=5,
            status="ok",
        )

    def on_session_end(
        self, *, session_id: str = "session-1", completed: bool = True, interrupted: bool = False
    ) -> None:
        """hooks.md ``on_session_end``: session_id, completed, interrupted, model, platform."""
        self._invoke(
            "on_session_end",
            session_id=session_id,
            completed=completed,
            interrupted=interrupted,
            model="test/model",
            platform="cli",
        )

    def kanban_task_completed(self, *, task_id: str = "t_1", summary: str = "done") -> None:
        """hooks.md ``kanban_task_completed``: task_id, profile_name, board, assignee, run_id, summary."""
        self._invoke(
            "kanban_task_completed",
            task_id=task_id,
            profile_name="default",
            board="default",
            assignee="orchestrator",
            run_id=1,
            summary=summary,
        )

    # --- inspection -----------------------------------------------------------------------

    def system_prompt(self) -> str:
        return "\n\n".join(s["content"] for s in self.ctx.sections.values())

    def mcp_tools_called(self) -> list[str]:
        return [tool for _, tool, _, _ in self.ctx.mcp_calls]
