# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Plugin settings: ``plugins.entries.<plugin_id>.settings.<key>`` read with ``ctx.get_config``
(hermes-agent hermes_cli/plugins.py, PluginContext.get_config). The ``mcp_allowlist`` is not a
setting: it sits one level up, at ``plugins.entries.<plugin_id>.mcp_allowlist``, and is read by
Hermes itself in ``ctx.call_mcp`` (default-deny)."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

ULID_RE = re.compile(r"^[0-7][0-9A-HJKMNP-TV-Z]{25}$")
AGENT_RE = re.compile(r"^agent:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SERVER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


@dataclass(frozen=True)
class Settings:
    server: str = "worldbuilder"
    world_id: str = ""
    lage_id: str = ""
    max_context_items: int = 12
    max_context_chars: int = 6000
    call_timeout: float = 15.0
    require_receipt_for_delegation: bool = False
    gate_kanban_complete: bool = True
    route_memory: bool = True
    memory_on_error: str = "allow"
    task_ref_prefix: str = "hermes"
    agent: str = "agent:hermes"
    task_records_dir: str = ""  # empty: <HERMES_HOME>/worldbuilder/task-records

    def problems(self) -> list[str]:
        """Configuration errors that make a consult impossible. Reported to the model and the
        operator in every turn; never silently ignored."""
        found = []
        if not SERVER_RE.match(self.server):
            found.append("settings.server is not a valid MCP server name")
        if not ULID_RE.match(self.world_id):
            found.append(
                "settings.world_id is missing or not a ULID "
                "(set plugins.entries.worldbuilder-knowledge-loop.settings.world_id)"
            )
        if self.lage_id and not ULID_RE.match(self.lage_id):
            found.append("settings.lage_id is not a ULID")
        if not AGENT_RE.match(self.agent):
            found.append("settings.agent is not agent:<name> (the name the agent is registered with)")
        return found


DEFAULT_HOOK_TIMEOUT = 30.0  # plugins.hook_callback_timeout default (hermes_cli/config_defaults.py)
HOOK_MARGIN = 5.0


def default_task_records_dir() -> str:
    home = os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")
    return os.path.join(home, "worldbuilder", "task-records")


def hook_budget() -> float:
    """Seconds a ``pre_tool_call`` callback may spend on Worldbuilder calls: Hermes' own
    ``plugins.hook_callback_timeout`` (read from its config when the plugin runs inside Hermes)
    minus a margin, because a callback that runs over is abandoned and the tool is blocked."""
    timeout = DEFAULT_HOOK_TIMEOUT
    try:
        from hermes_cli.config import load_config_readonly  # type: ignore[import-not-found]

        plugins_cfg = (load_config_readonly() or {}).get("plugins")
        if isinstance(plugins_cfg, dict) and plugins_cfg.get("hook_callback_timeout") is not None:
            value = float(plugins_cfg["hook_callback_timeout"])
            timeout = value if value > 0 else 120.0  # 0 disables the timeout: keep a sane cap
    except Exception:
        pass  # not inside Hermes, or an unreadable value: the default applies
    return max(2.0, timeout - HOOK_MARGIN)


def _get(ctx: Any, key: str, default: Any) -> Any:
    getter = getattr(ctx, "get_config", None)
    if getter is None:
        return default
    try:
        value = getter(key, default)
    except Exception:
        return default
    return default if value is None else value


def _as_bool(value: Any, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def _as_int(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(number, high))


def _as_float(value: Any, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(number, high))


def load_settings(ctx: Any) -> Settings:
    d = Settings()
    world_id = str(_get(ctx, "world_id", "") or os.environ.get("WORLDBUILDER_WORLD_ID", "")).strip()
    memory_on_error = str(_get(ctx, "memory_on_error", d.memory_on_error)).strip().lower()
    return Settings(
        server=str(_get(ctx, "server", d.server)).strip(),
        world_id=world_id,
        lage_id=str(_get(ctx, "lage_id", "")).strip(),
        max_context_items=_as_int(_get(ctx, "max_context_items", d.max_context_items), d.max_context_items, 1, 50),
        max_context_chars=_as_int(_get(ctx, "max_context_chars", d.max_context_chars), d.max_context_chars, 500, 20000),
        call_timeout=_as_float(_get(ctx, "call_timeout", d.call_timeout), d.call_timeout, 1.0, 25.0),
        require_receipt_for_delegation=_as_bool(
            _get(ctx, "require_receipt_for_delegation", d.require_receipt_for_delegation), False
        ),
        gate_kanban_complete=_as_bool(_get(ctx, "gate_kanban_complete", d.gate_kanban_complete), True),
        route_memory=_as_bool(_get(ctx, "route_memory", d.route_memory), True),
        memory_on_error=memory_on_error if memory_on_error in ("allow", "block") else "allow",
        task_ref_prefix=re.sub(r"[^A-Za-z0-9._-]", "-", str(_get(ctx, "task_ref_prefix", d.task_ref_prefix)))[:32]
        or "hermes",
        agent=str(_get(ctx, "agent", d.agent)).strip(),
        task_records_dir=str(_get(ctx, "task_records_dir", "") or "").strip(),
    )
