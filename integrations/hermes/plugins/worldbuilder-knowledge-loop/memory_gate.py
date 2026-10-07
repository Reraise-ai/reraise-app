# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Route writes of Hermes' ``memory`` tool: durable lessons become card proposals.

The only point before a built-in memory write is ``pre_tool_call`` for tool ``memory``
(hermes-agent findings; MemoryProvider.on_memory_write is post-write). The ``memory`` tool takes
``target`` (``memory`` = the agent's own notes, ``user`` = the user's profile) and either one
operation (``action``, ``content`` or its alias ``new_text``, ``old_text``) or ``operations``, a
batch of such items (hermes-agent tools/memory_tool.py, ``MEMORY_SCHEMA``).

Per item that adds or replaces text of target ``memory``:

* ``memory_route`` says ``card_proposal`` -> ``knowledge_write_back`` proposes a private card, and
  the item is removed from the memory write (the lesson lives on the board, not in a second store);
* ``ephemeral_ops_fact`` -> the memory write goes ahead unchanged.

Target ``user`` is never sent to the Worldbuilder: it holds personal profile facts.
"""

from __future__ import annotations

import re
from typing import Any

from .client import Deadline, WorldbuilderClient, WorldbuilderError
from .session import SessionStore, TaskState, derive_task_ref
from .settings import ULID_RE, Settings

_WRITE_ACTIONS = ("add", "replace")
_MAX_TEXT = 4000  # schemas/memory-route.schema.json#/$defs/request
_HOOK_BUDGET_SECONDS = 25.0  # Hermes abandons a pre_tool_call callback after 30 s (fails closed)


def _content(op: dict[str, Any]) -> str:
    value = op.get("content") or op.get("new_text") or ""
    return value if isinstance(value, str) else ""


def _title(text: str) -> str:
    first = re.split(r"(?<=[.!?])\s|\n", text.strip(), maxsplit=1)[0].strip()
    return (first[:100] or "Agent memory").strip()


def card_draft(text: str, world_id: str) -> dict[str, Any]:
    """A private experience card (schemas/card.schema.json#/$defs/draft). The author comes from the
    connection, release can only be private and training only false (ADR-0036, ADR-0039)."""
    return {
        "format": 2,
        "collection": "evidence",
        "type": "experience",
        "title": _title(text),
        "body": text.strip(),
        "layer": "experience",
        "originSystem": "hermes-memory",
        "worlds": [world_id],
        "release": "private",
        "training": False,
    }


def make_memory_policy(client: WorldbuilderClient, settings: Settings, store: SessionStore):
    def fail(message: str) -> dict[str, Any] | None:
        if settings.memory_on_error == "block":
            return {
                "action": "block",
                "message": f"memory write blocked: {message}. Retry later or keep the note out of memory.",
            }
        return None  # allow: the note stays where it always went; nothing is lost

    def route_one(
        text: str, state: TaskState, deadline: Deadline
    ) -> tuple[str, dict[str, Any] | None]:
        """('ephemeral', None) or ('card', write-back result); raises WorldbuilderError."""
        routed = client.call("memory_route", {"text": text}, deadline)
        if routed.get("route") != "card_proposal":
            return "ephemeral", None
        arguments: dict[str, Any] = {
            "taskRef": state.task_ref,
            "card": card_draft(text, settings.world_id),
            "rationale": f"Routed from a memory write (memory_route {routed.get('classifier', '')}, "
            f"rule {routed.get('ruleId', '')}).",
        }
        if state.consult is not None:
            arguments["consultReceiptId"] = state.consult.receipt_id
        result = client.call("knowledge_write_back", arguments, deadline)
        receipt = result.get("receipt")
        proposal = result.get("proposal")
        if (
            not isinstance(receipt, dict)
            or receipt.get("result") != "proposed"
            or not isinstance(proposal, dict)
            or not ULID_RE.match(str(proposal.get("id", "")))
        ):
            raise WorldbuilderError("malformed", "knowledge_write_back: no proposal in the result")
        return "card", result

    def memory_policy(args: dict[str, Any], session_id: str, task_id: str) -> dict[str, Any] | None:
        if not settings.route_memory or args.get("target", "memory") != "memory":
            return None
        batch = args.get("operations") if isinstance(args.get("operations"), list) else None
        operations = batch if batch is not None else [args]
        candidates = [
            (index, _content(op))
            for index, op in enumerate(operations)
            if isinstance(op, dict)
            and op.get("action") in _WRITE_ACTIONS
            and _content(op).strip()
            and len(_content(op)) <= _MAX_TEXT
        ]
        if not candidates:
            return None

        key = store.key(session_id, task_id)
        state = store.get(key) or TaskState(task_ref=derive_task_ref("memory", key))
        deadline = Deadline(_HOOK_BUDGET_SECONDS)
        routed_away: dict[int, dict[str, Any]] = {}
        try:
            for index, text in candidates:
                kind, result = route_one(text, state, deadline)
                if kind == "card" and result is not None:
                    routed_away[index] = result
        except WorldbuilderError as exc:
            if routed_away:
                # Some items already became proposals: keep them out of memory, and say that the
                # rest was not routed, so nothing is written twice and nothing is dropped.
                return _apply(batch, args, routed_away, note=f"routing stopped ({exc.kind}); the other items were not written")
            return fail(f"{exc.kind}: {exc.message}")
        if not routed_away:
            return None
        last = list(routed_away.values())[-1]["receipt"]
        state.write_back = {"receiptId": last["receiptId"], "hash": last["hash"]}
        store.put(key, state)
        return _apply(batch, args, routed_away)

    def _apply(
        batch: list[Any] | None,
        args: dict[str, Any],
        routed_away: dict[int, dict[str, Any]],
        note: str = "",
    ) -> dict[str, Any]:
        lines = []
        for result in routed_away.values():
            receipt, proposal = result["receipt"], result["proposal"]
            lines.append(
                f"proposal {proposal['id']} (write-back receipt {receipt['receiptId']}, "
                f"hash {receipt['hash']})"
            )
        summary = (
            "Worldbuilder: the durable lesson was proposed as a private card, not saved to memory: "
            + "; ".join(lines)
            + ". The human reviews it on the board. Do not repeat this memory write."
        )
        if note:
            summary += f" Note: {note}."
        if batch is not None:
            remaining = [op for index, op in enumerate(batch) if index not in routed_away]
            if remaining and not note:
                return {"action": "modify", "args": {"operations": remaining}}
        return {"action": "block", "message": summary}

    return memory_policy
