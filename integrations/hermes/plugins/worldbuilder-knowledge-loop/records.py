# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Task records: one JSON file per task, for the nightly validation and the metrics.

``wb receipts verify <folder>`` and ``wb metrics --tasks <folder>`` read task records
(schemas/task-record.schema.json, ADR-0040). Hermes does not write them, so the plugin does:

* ``on_session_end`` fires when a turn is finalised (hermes-agent website/docs/user-guide/
  features/hooks.md: ``session_id``, ``completed``, ``interrupted``); the record of the session's
  task is (re)written with the receipts known so far, so a task whose agent never consulted gets a
  record without a receipt and fails verification instead of being invisible;
* ``kanban_task_completed`` (``task_id``, ``assignee``, ``summary``) finalises the task of a kanban
  worker the same way;
* ``post_tool_call`` notes receipts of ``knowledge_consult`` and ``knowledge_write_back`` that the
  model called itself through the MCP tools (the plugin sees its own calls directly).

The file name derives from the task reference, so repeated turns overwrite one file. The receipts
are copied as the service returned them; the verifier, not the plugin, decides whether they are valid.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from typing import Any

from .consult import HASH_RE
from .outbox import Outbox
from .session import SessionStore, TaskState, utc_now
from .settings import ULID_RE, Settings, default_task_records_dir

logger = logging.getLogger(__name__)


def records_dir(settings: Settings) -> str:
    return settings.task_records_dir or default_task_records_dir()


def build_record(state: TaskState, agent: str) -> dict[str, Any]:
    record: dict[str, Any] = {
        "taskRef": state.task_ref,
        "agent": agent,
        "startedAt": state.started_at,
        "completedAt": utc_now(),
    }
    if state.consult is not None:
        record["knowledgeReceipt"] = {"receiptId": state.consult.receipt_id, "hash": state.consult.receipt_hash}
    elif state.model_consult is not None:
        record["knowledgeReceipt"] = dict(state.model_consult)
    if state.write_back is not None:
        record["writeBackReceipt"] = dict(state.write_back)
    return record


def write_record(settings: Settings, state: TaskState) -> str | None:
    """Write (replace) the record of a task; returns the path, or None when it could not be written
    (logged, never raised: an observer hook must not break the agent)."""
    directory = records_dir(settings)
    name = re.sub(r"[^A-Za-z0-9._-]", "_", state.task_ref) + ".json"
    try:
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(build_record(state, settings.agent), handle, indent=2)
            handle.write("\n")
        path = os.path.join(directory, name)
        os.replace(tmp, path)
        return path
    except OSError as exc:
        logger.warning("worldbuilder-knowledge-loop: cannot write the task record (%s)", type(exc).__name__)
        return None


def _receipt_from_result(result: Any) -> dict[str, Any] | None:
    """The ``receipt`` object in an MCP tool result as Hermes hands it to ``post_tool_call``: a JSON
    string whose shape depends on the transport (the object itself, ``{"result": ...}`` or
    ``{"structuredContent": ...}``). Tolerant on purpose; anything else yields None."""
    for _ in range(4):
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except ValueError:
                return None
        if not isinstance(result, dict):
            return None
        if isinstance(result.get("receipt"), dict):
            return result["receipt"]
        result = result.get("structuredContent") or result.get("result")
    return None


def make_post_tool_call(settings: Settings, store: SessionStore):
    consult_tool = f"mcp__{settings.server}__knowledge_consult"
    write_back_tool = f"mcp__{settings.server}__knowledge_write_back"

    def post_tool_call(**kwargs: Any) -> None:
        tool = str(kwargs.get("tool_name") or "")
        if tool not in (consult_tool, write_back_tool):
            return
        receipt = _receipt_from_result(kwargs.get("result"))
        if (
            receipt is None
            or not ULID_RE.match(str(receipt.get("receiptId", "")))
            or not HASH_RE.match(str(receipt.get("hash", "")))
        ):
            return
        key = store.key(str(kwargs.get("session_id") or ""), str(kwargs.get("task_id") or ""))
        with store.session_lock(key):
            state = store.get(key)
            if state is None or receipt.get("taskRef") != state.task_ref:
                return  # a receipt for another task is not this task's
            ref = {"receiptId": receipt["receiptId"], "hash": receipt["hash"]}
            if tool == write_back_tool and receipt.get("kind") == "write_back":
                state.write_back = ref
            elif tool == consult_tool and receipt.get("kind") == "knowledge" and state.consult is None:
                # A consult the model made itself counts only when the plugin's own failed.
                logger.info("worldbuilder-knowledge-loop: noted a model-made consult receipt")
                state.model_consult = ref

    return post_tool_call


def _note_pending(outbox: Outbox | None, state: TaskState) -> None:
    """Memory writes of this task that are still not offered as proposals. The task-record schema has
    no field for them (ADR-0046, known gap), so the session end says so in the log; the outbox entries
    carry the task reference and the nightly check reports them."""
    if outbox is None or not state.queued:
        return
    try:
        open_ids = {e["outboxId"] for e in outbox.entries() if e["status"] in ("pending", "submitting")}
    except OSError:
        return
    left = [i for i in state.queued if i in open_ids]
    if left:
        logger.warning(
            "worldbuilder-knowledge-loop: task %s ends with %d pending write-back entr%s (%s)",
            state.task_ref,
            len(left),
            "y" if len(left) == 1 else "ies",
            ", ".join(left),
        )


def make_session_end(settings: Settings, store: SessionStore, outbox: Outbox | None = None):
    def on_session_end(session_id: str = "", completed: bool = True, **kwargs: Any) -> None:
        if completed is False:
            return  # no final answer: nothing was handed off
        key = store.key(session_id, str(kwargs.get("task_id") or ""))
        with store.session_lock(key):
            state = store.get(key)
            if state is not None:
                write_record(settings, state)
                _note_pending(outbox, state)

    return on_session_end


def make_kanban_completed(settings: Settings, store: SessionStore):
    def kanban_task_completed(task_id: str = "", **kwargs: Any) -> None:
        # The worker process runs one kanban task: its session is the one whose key is the task id,
        # else the most recently used one.
        states = store.items()
        match = [s for k, s in states if k == str(task_id)]
        if not match and states:
            match = [states[-1][1]]
        for state in match:
            write_record(settings, state)

    return kanban_task_completed
