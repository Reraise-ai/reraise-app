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

When the Worldbuilder cannot be reached (or routing fails) the setting ``memory_on_error`` decides
(ADR-0046): ``queue`` (default) lets the write through, but never silently. Hermes' ``pre_tool_call``
may return ``{"action": "modify", "args": {...}}``, whose keys are merged into the tool arguments
(hermes_cli/plugins.py, ``_get_pre_tool_call_directive_details``), so the stored text is prefixed with
``[pending write-back <outboxId>]`` and the entry is appended to the owner-only outbox
(``outbox.py``) for the flush (``flush.py``). ``block`` stops the write instead.
"""

from __future__ import annotations

import logging
from typing import Any

from .cards import card_draft
from .client import Deadline, WorldbuilderClient, WorldbuilderError
from .flush import Flusher
from .outbox import Outbox, marker
from .session import SessionStore, TaskState, derive_task_ref
from .settings import ULID_RE, Settings, hook_budget

logger = logging.getLogger(__name__)

_WRITE_ACTIONS = ("add", "replace")
_MAX_TEXT = 4000  # schemas/memory-route.schema.json#/$defs/request


def _content(op: dict[str, Any]) -> str:
    value = op.get("content") or op.get("new_text") or ""
    return value if isinstance(value, str) else ""


def _with_marker(op: dict[str, Any], outbox_id: str) -> dict[str, Any]:
    """A copy of the operation whose text (``content``, or its alias ``new_text``) is prefixed."""
    key = "content" if op.get("content") else "new_text"
    return {**op, key: f"{marker(outbox_id)} {op[key]}"}


def make_memory_policy(
    client: WorldbuilderClient, settings: Settings, store: SessionStore, outbox: Outbox, flusher: Flusher
):
    def route_one(text: str, state: TaskState, deadline: Deadline) -> tuple[str, dict[str, Any] | None]:
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

    def block_message(message: str) -> dict[str, Any]:
        return {
            "action": "block",
            "message": f"memory write blocked: {message}. Retry later or keep the note out of memory.",
        }

    def queue(
        args: dict[str, Any],
        batch: list[Any] | None,
        undecided: list[tuple[int, str]],
        routed_away: dict[int, dict[str, Any]],
        state: TaskState,
        known: bool,
        why: str,
    ) -> dict[str, Any]:
        """Let the write through, marked and recorded (``memory_on_error: queue``)."""
        ids: dict[int, str] = {}
        try:
            for index, text in undecided:
                ids[index] = outbox.append(settings.agent, state.task_ref, text)["outboxId"]
        except OSError as exc:
            # Nothing may bypass the loop silently: no durable record, no memory write.
            logger.error("worldbuilder-knowledge-loop: cannot record a pending write-back (%s)", type(exc).__name__)
            return block_message(f"{why}, and the pending write-back could not be recorded ({type(exc).__name__})")
        state.queued.extend(ids.values())
        notice = (
            f"Worldbuilder: {len(ids)} memory write(s) were saved to your memory but are marked "
            f"'pending write-back' ({', '.join(ids.values())}): the Worldbuilder was not reachable ({why}). "
            "They will be offered as private card proposals automatically once it is reachable again."
        )
        if routed_away:
            notice += " Proposed as private cards and not saved to memory: " + _proposal_lines(routed_away) + "."
        if known:
            state.notices.append(notice)
        if batch is None:
            op = _with_marker(args, ids[undecided[0][0]])
            key = "content" if args.get("content") else "new_text"
            return {"action": "modify", "args": {key: op[key]}}
        operations = [
            _with_marker(op, ids[index]) if index in ids else op
            for index, op in enumerate(batch)
            if index not in routed_away
        ]
        return {"action": "modify", "args": {"operations": operations}}

    def memory_policy(args: dict[str, Any], session_id: str, task_id: str) -> dict[str, Any] | None:
        if not settings.route_memory or (args.get("target") or "memory") != "memory":
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
        known_state = store.get(key)
        state = known_state or TaskState(task_ref=derive_task_ref("memory", key))
        deadline = Deadline(hook_budget())
        routed_away: dict[int, dict[str, Any]] = {}
        ephemeral: set[int] = set()
        failure: WorldbuilderError | None = None
        for index, text in candidates:
            try:
                kind, result = route_one(text, state, deadline)
            except WorldbuilderError as exc:
                failure = exc
                break
            if kind == "card" and result is not None:
                routed_away[index] = result
            else:
                ephemeral.add(index)
        if failure is not None:
            # No memory text in the log: it may hold anything the agent was told.
            logger.warning(
                "worldbuilder-knowledge-loop: memory routing failed (%s) after %d of %d items",
                failure.kind,
                len(routed_away) + len(ephemeral),
                len(candidates),
            )
            if routed_away:
                state.write_back = _last_receipt(routed_away)
                store.put(key, state)
            if settings.memory_on_error == "block":
                if routed_away:
                    # Some items already became proposals: keep them out of memory, and say that the
                    # rest was not routed, so nothing is written twice and nothing is dropped.
                    return _apply(
                        batch,
                        args,
                        routed_away,
                        state,
                        note=f"routing stopped ({failure.kind}); the other items were not written",
                    )
                return block_message(f"{failure.kind}: {failure.message}")
            undecided = [(i, t) for i, t in candidates if i not in routed_away and i not in ephemeral]
            return queue(args, batch, undecided, routed_away, state, known_state is not None, f"{failure.kind}")
        if routed_away:
            state.write_back = _last_receipt(routed_away)
            store.put(key, state)
        # The service answered: this is the moment to offer what was queued before.
        self_flush(state, known_state is not None or bool(routed_away), deadline)
        if not routed_away:
            return None
        return _apply(batch, args, routed_away, state)

    def self_flush(state: TaskState, can_notify: bool, deadline: Deadline) -> None:
        if deadline.remaining() < 6.0 or not flusher.has_open():
            return
        flushed = flusher.flush(Deadline(min(10.0, deadline.remaining() - 3.0)))
        text = flushed.notice()
        if text and can_notify:
            state.notices.append(text)

    def _last_receipt(routed_away: dict[int, dict[str, Any]]) -> dict[str, str]:
        last = list(routed_away.values())[-1]["receipt"]
        return {"receiptId": last["receiptId"], "hash": last["hash"]}

    def _proposal_lines(routed_away: dict[int, dict[str, Any]]) -> str:
        lines = []
        for result in routed_away.values():
            receipt, proposal = result["receipt"], result["proposal"]
            lines.append(
                f"proposal {proposal['id']} (write-back receipt {receipt['receiptId']}, hash {receipt['hash']})"
            )
        return "; ".join(lines)

    def enqueue_after_error(args: dict[str, Any], session_id: str, task_id: str, why: str) -> dict[str, Any] | None:
        """For an unexpected error inside the policy: the same ``queue`` outcome for every item that
        could be routed. Returns None when the call is not a routable memory write."""
        if not settings.route_memory or (args.get("target") or "memory") != "memory":
            return None
        batch = args.get("operations") if isinstance(args.get("operations"), list) else None
        operations = batch if batch is not None else [args]
        undecided = [
            (index, _content(op))
            for index, op in enumerate(operations)
            if isinstance(op, dict)
            and op.get("action") in _WRITE_ACTIONS
            and _content(op).strip()
            and len(_content(op)) <= _MAX_TEXT
        ]
        if not undecided:
            return None
        key = store.key(session_id, task_id)
        known = store.get(key)
        state = known or TaskState(task_ref=derive_task_ref("memory", key))
        return queue(args, batch, undecided, {}, state, known is not None, why)

    def _apply(
        batch: list[Any] | None,
        args: dict[str, Any],
        routed_away: dict[int, dict[str, Any]],
        state: TaskState | None = None,
        note: str = "",
    ) -> dict[str, Any]:
        summary = (
            "Worldbuilder: the durable lesson was proposed as a private card, not saved to memory: "
            + _proposal_lines(routed_away)
            + ". The human reviews it on the board. Do not repeat this memory write."
        )
        if note:
            summary += f" Note: {note}."
        if batch is not None:
            remaining = [op for index, op in enumerate(batch) if index not in routed_away]
            if remaining and not note:
                # modify cannot carry a message: tell the model on its next turn which items
                # became proposals (pre_llm_call delivers state.notices once).
                if state is not None:
                    state.notices.append(summary)
                return {"action": "modify", "args": {"operations": remaining}}
        return {"action": "block", "message": summary}

    memory_policy.enqueue_after_error = enqueue_after_error  # type: ignore[attr-defined]
    return memory_policy
