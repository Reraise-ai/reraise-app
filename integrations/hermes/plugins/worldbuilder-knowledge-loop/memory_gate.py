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

import contextlib
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


def split_operations(args: dict[str, Any]) -> tuple[list[Any] | None, list[tuple[int, str]], list[tuple[int, str]]]:
    """(batch or None, routable items, over-long items). An empty ``operations`` list is no batch: the
    call is then a single operation (``add``/``replace`` with ``content``), as in Hermes' memory tool."""
    operations = args.get("operations")
    batch = operations if isinstance(operations, list) and operations else None
    items = batch if batch is not None else [args]
    routable: list[tuple[int, str]] = []
    too_long: list[tuple[int, str]] = []
    for index, op in enumerate(items):
        if not isinstance(op, dict) or op.get("action") not in _WRITE_ACTIONS:
            continue
        text = _content(op)
        if not text.strip():
            continue
        (routable if len(text) <= _MAX_TEXT else too_long).append((index, text))
    return batch, routable, too_long


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

    def proposal_lines(routed_away: dict[int, dict[str, Any]]) -> str:
        lines = []
        for result in routed_away.values():
            receipt, proposal = result["receipt"], result["proposal"]
            lines.append(
                f"proposal {proposal['id']} (write-back receipt {receipt['receiptId']}, hash {receipt['hash']})"
            )
        return "; ".join(lines)

    def last_receipt(routed_away: dict[int, dict[str, Any]]) -> dict[str, str]:
        last = list(routed_away.values())[-1]["receipt"]
        return {"receiptId": last["receiptId"], "hash": last["hash"]}

    def build(
        args: dict[str, Any],
        batch: list[Any] | None,
        routed_away: dict[int, dict[str, Any]],
        marks: dict[int, str],
        state: TaskState,
        notify: bool,
        note: str = "",
    ) -> dict[str, Any] | None:
        """The decision for the memory call: items that became proposals leave the write, items
        queued or held get the marker, all others stay as they are."""
        if not routed_away and not marks:
            return None
        proposed = (
            "Worldbuilder: the durable lesson was proposed as a private card, not saved to memory: "
            + proposal_lines(routed_away)
            + ". The human reviews it on the board. Do not repeat this memory write."
            if routed_away
            else ""
        )
        if note:
            proposed += f" Note: {note}."
        if batch is None:
            if not marks:
                return {"action": "block", "message": proposed}
            key = "content" if args.get("content") else "new_text"
            return {"action": "modify", "args": {key: _with_marker(args, marks[0])[key]}}
        operations = [
            _with_marker(op, marks[index]) if index in marks else op
            for index, op in enumerate(batch)
            if index not in routed_away
        ]
        if note or not operations:
            return {"action": "block", "message": proposed}
        if proposed and notify:
            # modify cannot carry a message: tell the model on its next turn (pre_llm_call delivers
            # state.notices once).
            state.notices.append(proposed)
        return {"action": "modify", "args": {"operations": operations}}

    def hold_too_long(too_long: list[tuple[int, str]], state: TaskState, marks: dict[int, str], notify: bool) -> None:
        """Over-long items never bypass the loop: marked, recorded as ``blocked_too_long``, never
        sent and never partially classified. Raises OSError if they cannot be recorded."""
        held = []
        for index, text in too_long:
            if index not in marks:
                marks[index] = outbox.append(settings.agent, state.task_ref, text, status="blocked_too_long")[
                    "outboxId"
                ]
                held.append(marks[index])
        if held and notify:
            state.notices.append(
                f"Worldbuilder: {len(held)} memory write(s) were too long to route ({_MAX_TEXT} characters at most), "
                f"were saved to your memory marked 'pending write-back' ({', '.join(held)}) and are held for the "
                "owner; they are not sent anywhere. Write shorter notes."
            )

    def queue(
        args: dict[str, Any],
        batch: list[Any] | None,
        undecided: list[tuple[int, str]],
        routed_away: dict[int, dict[str, Any]],
        marks: dict[int, str],
        state: TaskState,
        known: bool,
        why: str,
        session_id: str,
        task_id: str,
    ) -> dict[str, Any] | None:
        """Let the write through, marked and recorded (``memory_on_error: queue``)."""
        ids: dict[int, str] = {}
        try:
            for index, text in undecided:
                ids[index] = outbox.append(settings.agent, state.task_ref, text)["outboxId"]
        except OSError as exc:
            # Nothing may bypass the loop silently: no durable record, no memory write.
            logger.error("worldbuilder-knowledge-loop: cannot record a pending write-back (%s)", type(exc).__name__)
            release(marks)
            return block_message(f"{why}, and the pending write-back could not be recorded ({type(exc).__name__})")
        marks.update(ids)
        state.queued.extend(ids.values())
        store.put(store.key(session_id, task_id), state)  # the session end lists them in the task record
        if ids and known:
            state.notices.append(
                f"Worldbuilder: {len(ids)} memory write(s) were saved to your memory but are marked "
                f"'pending write-back' ({', '.join(ids.values())}): the Worldbuilder was not reachable ({why}). "
                "They will be offered as private card proposals automatically once it is reachable again."
            )
        return build(args, batch, routed_away, marks, state, known)

    def release(marks: dict[int, str]) -> None:
        """The write is blocked after all: the held entries would describe a write that never happened."""
        for outbox_id in marks.values():
            with contextlib.suppress(OSError):
                outbox.dismiss(outbox_id)

    def memory_policy(
        args: dict[str, Any], session_id: str, task_id: str, progress: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        """``progress`` (optional) receives what was decided so far, so that the caller's fallback for an
        unexpected error queues only what is still undecided."""
        if not settings.route_memory or (args.get("target") or "memory") != "memory":
            return None
        batch, candidates, too_long = split_operations(args)
        if not candidates and not too_long:
            return None

        key = store.key(session_id, task_id)
        known_state = store.get(key)
        state = known_state or TaskState(task_ref=derive_task_ref("memory", key))
        routed_away: dict[int, dict[str, Any]] = {}
        ephemeral: set[int] = set()
        marks: dict[int, str] = {}
        if progress is not None:
            progress.update(routed=routed_away, ephemeral=ephemeral, marks=marks)
        try:
            hold_too_long(too_long, state, marks, known_state is not None)
        except OSError as exc:
            logger.error("worldbuilder-knowledge-loop: cannot record a held write-back (%s)", type(exc).__name__)
            release(marks)
            return block_message(
                f"a memory write is too long to route and could not be recorded ({type(exc).__name__})"
            )
        if too_long:
            store.put(key, state)

        deadline = Deadline(hook_budget())
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
                state.write_back = last_receipt(routed_away)
                store.put(key, state)
            if settings.memory_on_error == "block":
                release(marks)
                if routed_away:
                    # Some items already became proposals: keep them out of memory, and say that the
                    # rest was not routed, so nothing is written twice and nothing is dropped.
                    return build(
                        args,
                        batch,
                        routed_away,
                        {},
                        state,
                        False,
                        note=f"routing stopped ({failure.kind}); the other items were not written",
                    )
                return block_message(f"{failure.kind}: {failure.message}")
            undecided = [(i, t) for i, t in candidates if i not in routed_away and i not in ephemeral]
            return queue(
                args,
                batch,
                undecided,
                routed_away,
                marks,
                state,
                known_state is not None,
                f"{failure.kind}",
                session_id,
                task_id,
            )
        if routed_away:
            state.write_back = last_receipt(routed_away)
            store.put(key, state)
        # The service answered: this is the moment to offer what was queued before.
        if candidates:
            self_flush(state, known_state is not None or bool(routed_away), deadline)
        return build(args, batch, routed_away, marks, state, known_state is not None or bool(routed_away))

    def self_flush(state: TaskState, can_notify: bool, deadline: Deadline) -> None:
        """Offer the queued writes with what is left of this hook's budget; a failure here never changes
        the memory decision."""
        try:
            if not flusher.has_open():
                return
            text = flusher.flush(deadline).notice()
            if text and can_notify:
                state.notices.append(text)
        except Exception as exc:
            logger.warning("worldbuilder-knowledge-loop: flush failed (%s)", type(exc).__name__)

    def enqueue_after_error(
        args: dict[str, Any], session_id: str, task_id: str, why: str, progress: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        """For an unexpected error inside the policy: the same ``queue`` outcome for every item that
        is still undecided (not already proposed or judged ephemeral in this very call). Returns None
        when the call is not a routable memory write."""
        if not settings.route_memory or (args.get("target") or "memory") != "memory":
            return None
        batch, candidates, too_long = split_operations(args)
        progress = progress or {}
        routed_away: dict[int, dict[str, Any]] = progress.get("routed", {})
        ephemeral: set[int] = progress.get("ephemeral", set())
        marks: dict[int, str] = progress.get("marks", {})
        undecided = [(i, t) for i, t in candidates if i not in routed_away and i not in ephemeral]
        if not undecided and not too_long and not routed_away and not marks:
            return None
        key = store.key(session_id, task_id)
        known = store.get(key)
        state = known or TaskState(task_ref=derive_task_ref("memory", key))
        try:
            hold_too_long(too_long, state, marks, known is not None)
        except OSError:
            release(marks)
            return block_message("not routed and not recorded")
        return queue(args, batch, undecided, routed_away, marks, state, known is not None, why, session_id, task_id)

    memory_policy.enqueue_after_error = enqueue_after_error  # type: ignore[attr-defined]
    return memory_policy
