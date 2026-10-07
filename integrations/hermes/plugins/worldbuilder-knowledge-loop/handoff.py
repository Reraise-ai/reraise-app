# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Mandatory hand-off fields, enforced in ``pre_tool_call``.

Two tools carry hand-offs in Hermes:

* ``delegate_task`` has an ``output_schema`` per task: the child is told its final answer must
  validate against it, the parent validates it once and reports ``schema_valid`` and
  ``schema_errors`` (hermes-agent tools/delegate_tool.py, tools/delegation_output_schema.py).
  A ``modify`` directive shallow-merges returned ``args`` over the call's arguments, so the plugin
  returns a whole new ``tasks`` list (hermes-agent website/docs/user-guide/features/hooks.md,
  ``pre_tool_call``; hermes_cli/plugins.py ``_get_pre_tool_call_directive_details``).
* ``kanban_complete(summary, result, metadata, ...)`` ends a kanban task; ``metadata`` is a free
  dict (hermes-agent tools/kanban_tools.py), so the convention is enforced with ``block``.

The hand-off fields (see docs/reference/knowledge-loop.md, task-record.schema.json):

``knowledgeReceipt`` and ``writeBackReceipt`` are ``{receiptId, hash}``, the very shape of a task
record's receipt reference, and ``cardWritten`` says what became of the lesson: ``{proposalId}``
(the proposal the write-back created; the card id exists only after the human accepted it),
``{cardId}`` (an existing card) or ``{notNeededBecause}`` (a closed list, no free text).
"""

from __future__ import annotations

import copy
import json
from typing import Any

from .consult import HASH_RE
from .session import SessionStore, TaskState, child_task_ref, derive_task_ref
from .settings import ULID_RE, Settings

NOT_NEEDED_REASONS = ("no_new_knowledge", "already_covered", "ephemeral_ops_fact", "task_abandoned")
CONTRACT_FIELDS = ("knowledgeReceipt", "writeBackReceipt", "cardWritten")
_COMPOSITION = ("allOf", "anyOf", "oneOf", "not", "$ref", "if", "then", "else")


def _ref_schema(description: str) -> dict[str, Any]:
    return {
        "type": "object",
        "description": description,
        "properties": {
            "receiptId": {"type": "string", "pattern": ULID_RE.pattern},
            "hash": {"type": "string", "pattern": HASH_RE.pattern},
        },
        "required": ["receiptId", "hash"],
        "additionalProperties": False,
    }


def contract_schema() -> dict[str, Any]:
    """The JSON Schema a hand-off must satisfy. Pure data, so tests can check it with a real
    validator and the verifier's task record can be built from a valid hand-off."""
    return {
        "type": "object",
        "properties": {
            "knowledgeReceipt": _ref_schema("Receipt of the knowledge_consult of this task."),
            "writeBackReceipt": _ref_schema("Receipt of the knowledge_write_back of this task."),
            "cardWritten": {
                "description": "What became of the lesson: a proposal or card id, or a coded reason.",
                "oneOf": [
                    {
                        "type": "object",
                        "properties": {"proposalId": {"type": "string", "pattern": ULID_RE.pattern}},
                        "required": ["proposalId"],
                        "additionalProperties": False,
                    },
                    {
                        "type": "object",
                        "properties": {"cardId": {"type": "string", "pattern": ULID_RE.pattern}},
                        "required": ["cardId"],
                        "additionalProperties": False,
                    },
                    {
                        "type": "object",
                        "properties": {"notNeededBecause": {"enum": list(NOT_NEEDED_REASONS)}},
                        "required": ["notNeededBecause"],
                        "additionalProperties": False,
                    },
                ],
            },
        },
        "required": list(CONTRACT_FIELDS),
    }


def _is_ref(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"receiptId", "hash"}
        and isinstance(value["receiptId"], str)
        and bool(ULID_RE.match(value["receiptId"]))
        and isinstance(value["hash"], str)
        and bool(HASH_RE.match(value["hash"]))
    )


def _is_card_written(value: Any) -> bool:
    if not isinstance(value, dict) or len(value) != 1:
        return False
    ((key, item),) = value.items()
    if key in ("proposalId", "cardId"):
        return isinstance(item, str) and bool(ULID_RE.match(item))
    return key == "notNeededBecause" and item in NOT_NEEDED_REASONS


def handoff_problems(fields: Any) -> list[str]:
    """What is wrong with a hand-off dict; empty when it is structurally valid. Structure only:
    whether the receipts are real is what ``wb receipts verify`` decides."""
    if not isinstance(fields, dict):
        return list(CONTRACT_FIELDS)
    found = []
    if not _is_ref(fields.get("knowledgeReceipt")):
        found.append("knowledgeReceipt {receiptId, hash}")
    if not _is_ref(fields.get("writeBackReceipt")):
        found.append("writeBackReceipt {receiptId, hash}")
    if not _is_card_written(fields.get("cardWritten")):
        found.append("cardWritten {proposalId} | {cardId} | {notNeededBecause}")
    return found


def merge_output_schema(existing: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Add the contract to a schema the model asked for. ``(schema, None)`` or ``(None, reason)``
    when the model's schema cannot be extended safely (then the call is blocked, not weakened)."""
    contract = contract_schema()
    if existing in (None, "", {}):
        return contract, None
    schema = existing
    if isinstance(schema, str):
        try:
            schema = json.loads(schema)  # models sometimes double-encode the schema
        except ValueError:
            return None, "its output_schema is a string that is not JSON"
    if not isinstance(schema, dict):
        return None, "its output_schema is not a JSON Schema object"
    if schema.get("type", "object") != "object":
        return None, "its output_schema is not an object schema"
    if any(key in schema for key in _COMPOSITION):
        return None, "its output_schema uses allOf/anyOf/oneOf/not/$ref/if, which cannot be extended"
    merged = copy.deepcopy(schema)
    merged["type"] = "object"
    properties = merged.setdefault("properties", {})
    if not isinstance(properties, dict):
        return None, "its output_schema has no usable properties"
    properties.update(contract["properties"])
    required = merged.get("required", [])
    merged["required"] = list(dict.fromkeys([*(required if isinstance(required, list) else []), *CONTRACT_FIELDS]))
    return merged, None


def handoff_block(parent_ref: str, child_ref: str, parent_receipt_id: str | None, server: str) -> str:
    consult = f"mcp__{server}__knowledge_consult"
    write_back = f"mcp__{server}__knowledge_write_back"
    parent = f"Parent knowledge receipt: {parent_receipt_id}\n" if parent_receipt_id else ""
    return (
        "WORLDBUILDER HAND-OFF (mandatory, checked by `wb receipts verify`):\n"
        f"Task ref: {child_ref}\n"
        f"Parent task ref: {parent_ref}\n"
        f"{parent}"
        f"1. Call {consult} with taskRef {child_ref} before you work (skip only if your context "
        "already holds a Knowledge receipt for this task ref).\n"
        f"2. Call {write_back} with the same taskRef before you finish: propose one card or give a "
        "coded reason.\n"
        "3. Your final answer must contain knowledgeReceipt, writeBackReceipt and cardWritten, "
        "copied from those results. Never invent them."
    )


def _block(message: str) -> dict[str, str]:
    return {"action": "block", "message": message}


def make_delegate_policy(settings: Settings, store: SessionStore):
    def delegate_policy(args: dict[str, Any], session_id: str, task_id: str) -> dict[str, Any] | None:
        # Hermes: ``(action or "").strip().lower()``; "" and "spawn" spawn, list/steer/stop control
        # running children, anything else is an error of Hermes' own (tools/delegate_tool.py).
        raw_action = args.get("action")
        action = (raw_action if isinstance(raw_action, str) else "").strip().lower()
        if action not in ("", "spawn"):
            return None  # list, steer, stop and unknown actions hand no work off
        key = store.key(session_id, task_id)
        with store.session_lock(key):
            return _spawn(args, key)

    def _spawn(args: dict[str, Any], key: str) -> dict[str, Any]:
        state = store.get(key) or TaskState(task_ref=derive_task_ref(settings.task_ref_prefix, key))
        store.put(key, state)
        if settings.require_receipt_for_delegation and state.consult is None:
            reason = state.failure or "no consult has happened for this task"
            return _block(
                f"delegate_task blocked: task {state.task_ref} has no Knowledge Receipt ({reason}). "
                "Consult the Worldbuilder knowledge first, or tell the human that it is unreachable."
            )
        parent_receipt = state.consult.receipt_id if state.consult else None

        tasks = args.get("tasks")
        if isinstance(tasks, str) and tasks.strip():
            try:
                tasks = json.loads(tasks)  # models sometimes pass the batch as a JSON string
            except ValueError:
                return _block("delegate_task blocked: `tasks` is a string that is not JSON; pass a list of tasks.")
        if tasks not in (None, "", []):
            if not isinstance(tasks, list) or not all(isinstance(t, dict) for t in tasks):
                return _block("delegate_task blocked: `tasks` must be a list of task objects.")
            new_tasks = []
            for task in tasks:
                rewritten = _rewrite_task(task, state, parent_receipt, settings)
                if isinstance(rewritten, str):
                    return _block(f"delegate_task blocked: {rewritten}")
                new_tasks.append(rewritten)
            return {"action": "modify", "args": {"tasks": new_tasks}}
        if isinstance(args.get("goal"), str) and args["goal"].strip():
            # The single-goal shape: top-level goal, context and output_schema.
            rewritten = _rewrite_task(
                {k: args[k] for k in ("goal", "context", "output_schema") if k in args},
                state,
                parent_receipt,
                settings,
            )
            if isinstance(rewritten, str):
                return _block(f"delegate_task blocked: {rewritten}")
            return {
                "action": "modify",
                "args": {k: rewritten[k] for k in ("goal", "context", "output_schema")},
            }
        # Fail closed: a spawn whose shape is not understood would hand work off without the contract.
        return _block(
            "delegate_task blocked: neither `goal` nor `tasks` is usable, so the hand-off contract cannot be added."
        )

    def _rewrite_task(
        task: dict[str, Any], state: TaskState, parent_receipt: str | None, settings: Settings
    ) -> dict[str, Any] | str:
        schema, reason = merge_output_schema(task.get("output_schema"))
        if schema is None:
            return f"{reason}. Hand-offs must carry the Worldbuilder receipts; use a plain object schema or none."
        goal = task.get("goal")
        if not isinstance(goal, str) or not goal.strip():
            return "a task has no goal"
        state.delegations += 1
        child = child_task_ref(state.task_ref, state.delegations)
        block = handoff_block(state.task_ref, child, parent_receipt, settings.server)
        base = task.get("context")
        context = f"{base.rstrip()}\n\n{block}" if isinstance(base, str) and base.strip() else block
        # The child's first turn may be only its goal: the reference goes first, where
        # explicit_task_ref finds it, so the child consults for its own task, not its parent's.
        return {**task, "goal": f"Task ref: {child}\n{goal}", "output_schema": schema, "context": context}

    return delegate_policy


def make_kanban_policy(settings: Settings):
    def kanban_policy(args: dict[str, Any]) -> dict[str, Any] | None:
        if not settings.gate_kanban_complete:
            return None
        missing = handoff_problems(args.get("metadata"))
        if not missing:
            return None
        return _block(
            "kanban_complete blocked: the hand-off metadata lacks "
            + "; ".join(missing)
            + f". Call mcp__{settings.server}__knowledge_write_back if you have not yet, then pass "
            "knowledgeReceipt, writeBackReceipt and cardWritten from the tool results in "
            "metadata. If no consult happened, the receipt does not exist: report the task as "
            "blocked instead of inventing one."
        )

    return kanban_policy
