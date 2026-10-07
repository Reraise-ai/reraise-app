# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Worldbuilder knowledge loop for Hermes (native plugin: plugin.yaml + register(ctx)).

What it does, in Hermes terms (hermes-agent hermes_cli/plugins.py, website/docs/user-guide/
features/hooks.md):

* ``pre_llm_call``: at the first turn of a task, and when the task changes, consults the knowledge
  through ``ctx.call_mcp(<server>, "knowledge_consult", ...)`` and injects the package summary and
  the Knowledge Receipt into the turn. If that fails it injects a clear notice and records that no
  receipt exists, so the task fails ``wb receipts verify`` instead of passing as consulted.
* ``pre_tool_call`` on ``delegate_task``: rewrites the call so every child must return
  ``knowledgeReceipt``, ``writeBackReceipt`` and ``cardWritten``; on ``kanban_complete``: blocks a
  hand-off without them.
* ``pre_tool_call`` on ``memory``: routes writes with ``memory_route``; durable lessons become
  private card proposals through ``knowledge_write_back``.
* a short rule in the system prompt (``register_system_prompt_section``).

The MCP server must be listed in ``plugins.entries.worldbuilder-knowledge-loop.mcp_allowlist``;
Hermes denies every other MCP server to a plugin by default.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .client import WorldbuilderClient
from .consult import make_pre_llm_call
from .handoff import make_delegate_policy, make_kanban_policy
from .memory_gate import make_memory_policy
from .prompt import SECTION_ID, rule_text
from .session import SessionStore
from .settings import Settings, load_settings

logger = logging.getLogger(__name__)

__all__ = ["register", "Settings"]


def _tool_name_args(kwargs: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    args = kwargs.get("args")
    return str(kwargs.get("tool_name") or ""), args if isinstance(args, dict) else {}


def register(ctx: Any) -> None:
    settings = load_settings(ctx)
    client = WorldbuilderClient(ctx, settings)
    store = SessionStore()

    delegate_policy = make_delegate_policy(settings, store)
    kanban_policy = make_kanban_policy(settings)
    memory_policy = make_memory_policy(client, settings, store)

    def pre_tool_call_handoff(**kwargs: Any) -> dict[str, Any] | None:
        tool_name, args = _tool_name_args(kwargs)
        if tool_name not in ("delegate_task", "kanban_complete"):
            return None
        try:
            if tool_name == "delegate_task":
                return delegate_policy(args, str(kwargs.get("session_id") or ""), str(kwargs.get("task_id") or ""))
            return kanban_policy(args)
        except Exception as exc:  # fail closed, with a message the model and the operator can read
            logger.exception("worldbuilder-knowledge-loop: hand-off check failed")
            return {"action": "block", "message": f"{tool_name} blocked: hand-off check failed ({type(exc).__name__})"}

    def pre_tool_call_memory(**kwargs: Any) -> dict[str, Any] | None:
        tool_name, args = _tool_name_args(kwargs)
        if tool_name != "memory":
            return None
        try:
            return memory_policy(args, str(kwargs.get("session_id") or ""), str(kwargs.get("task_id") or ""))
        except Exception as exc:
            logger.exception("worldbuilder-knowledge-loop: memory routing failed")
            if settings.memory_on_error == "block":
                return {"action": "block", "message": f"memory write blocked: routing failed ({type(exc).__name__})"}
            return None

    ctx.register_hook("pre_llm_call", make_pre_llm_call(client, settings, store))
    ctx.register_hook("pre_tool_call", pre_tool_call_handoff)
    ctx.register_hook("pre_tool_call", pre_tool_call_memory)
    ctx.register_system_prompt_section(SECTION_ID, rule_text(settings.server), position="after_memory")

    register_skill = getattr(ctx, "register_skill", None)
    skill_md = Path(__file__).resolve().parent / "skills" / "reviewer" / "SKILL.md"
    if register_skill is not None and skill_md.is_file():
        register_skill("reviewer", skill_md, "Rejects agent work without valid Worldbuilder receipts.")

    problems = settings.problems()
    if problems:
        logger.warning("worldbuilder-knowledge-loop is not fully configured: %s", "; ".join(problems))
