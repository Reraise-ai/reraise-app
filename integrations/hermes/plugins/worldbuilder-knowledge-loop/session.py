# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Per-session task state and task references.

A ``taskRef`` is an opaque id (ADR-0039, schemas/common.schema.json#/$defs/taskRef): 1 to 128 of
``A-Z a-z 0-9 . _ : / # -``, starting with a letter or digit, no ``//``. It is either named by the
task text (a line ``Task ref: <id>``, written by the task and hand-off templates) or derived from
the Hermes session id.
"""

from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

TASK_REF_RE = re.compile(r"^(?!.*//)[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$")
_TASK_REF_LINE = re.compile(
    r"(?im)^[ \t>*_-]*task[ _-]?ref(?:erence)?[ \t*_]*[:=][ \t*_`]*([A-Za-z0-9][A-Za-z0-9._:/#-]{0,127})"
)


def message_text(user_message: Any) -> str:
    """The text of a turn. ``pre_llm_call`` gets a ``str`` or, for a multimodal turn, the list of
    content parts (hermes-agent website/docs/user-guide/features/hooks.md, ``pre_llm_call``)."""
    if isinstance(user_message, str):
        return user_message
    if isinstance(user_message, list):
        parts = []
        for part in user_message:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "\n".join(parts)
    return ""


_HANDOFF_MARK = "WORLDBUILDER HAND-OFF"


def explicit_task_ref(text: str) -> str | None:
    """The task reference a turn names. A hand-off block written by this plugin wins over any other
    ``Task ref:`` line, so a child that copied its parent's reference into the goal still works on
    its own reference; otherwise the first valid line counts."""
    start = text.find(_HANDOFF_MARK)
    for chunk in ([text[start:]] if start >= 0 else []) + [text]:
        for match in _TASK_REF_LINE.finditer(chunk):
            ref = match.group(1)
            if TASK_REF_RE.match(ref):
                return ref
    return None


def derive_task_ref(prefix: str, session_id: str) -> str:
    """A valid task reference from an arbitrary session id. Deterministic."""
    cleaned = re.sub(r"[^A-Za-z0-9._:/#-]", "-", session_id or "session")
    cleaned = re.sub(r"/{2,}", "/", cleaned)
    ref = f"{prefix}:{cleaned}"[:128]
    return ref if TASK_REF_RE.match(ref) else f"{prefix}:session"


def child_task_ref(parent: str, number: int) -> str:
    suffix = f".s{number}"
    ref = parent[: 128 - len(suffix)] + suffix
    return ref if TASK_REF_RE.match(ref) else f"hermes:child{suffix}"


@dataclass
class ConsultInfo:
    receipt_id: str
    receipt_hash: str
    result: str  # cards | nothing_found | confirmation_required
    card_ids: list[str]
    package_id: str
    transfer_id: str | None = None


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class TaskState:
    task_ref: str
    task_text: str = ""  # the text the consult was asked with; retries ask the same question
    consult: ConsultInfo | None = None
    failure: str | None = None  # why there is no receipt, shown every turn until a consult works
    delegations: int = 0
    write_back: dict[str, str] | None = None  # {receiptId, hash} of the last write-back of this task
    model_consult: dict[str, str] | None = None  # a consult receipt the model obtained itself
    started_at: str = field(default_factory=lambda: utc_now())
    notices: list[str] = field(default_factory=list)  # told to the model on its next turn, once
    queued: list[str] = field(default_factory=list)  # outbox ids of memory writes queued in this task

    @property
    def needs_consult(self) -> bool:
        return self.consult is None or self.consult.result == "confirmation_required"


class SessionStore:
    """Task state per Hermes session, bounded (LRU with a time to live) because a long-running
    gateway sees an unbounded number of sessions. Reads and writes of the map are locked; a hook
    that changes a state holds ``session_lock(key)`` so two threads of one session do not race."""

    def __init__(self, max_entries: int = 512, ttl_seconds: float = 24 * 3600.0) -> None:
        self._states: OrderedDict[str, tuple[TaskState, float]] = OrderedDict()
        self._lock = threading.Lock()
        self._key_locks: dict[str, threading.RLock] = {}
        self._max = max_entries
        self._ttl = ttl_seconds

    def _prune(self, now: float) -> None:
        for key in [k for k, (_, seen) in self._states.items() if now - seen > self._ttl]:
            self._drop(key)
        while len(self._states) > self._max:
            self._drop(next(iter(self._states)))

    def _drop(self, key: str) -> None:
        self._states.pop(key, None)
        self._key_locks.pop(key, None)

    def get(self, key: str) -> TaskState | None:
        with self._lock:
            now = time.monotonic()
            self._prune(now)
            entry = self._states.get(key)
            if entry is None:
                return None
            self._states[key] = (entry[0], now)
            self._states.move_to_end(key)
            return entry[0]

    def put(self, key: str, state: TaskState) -> None:
        with self._lock:
            now = time.monotonic()
            self._states[key] = (state, now)
            self._states.move_to_end(key)
            self._prune(now)

    def items(self) -> list[tuple[str, TaskState]]:
        with self._lock:
            return [(k, v[0]) for k, v in self._states.items()]

    def session_lock(self, key: str) -> threading.RLock:
        with self._lock:
            return self._key_locks.setdefault(key, threading.RLock())

    def key(self, session_id: str = "", task_id: str = "") -> str:
        return session_id or task_id or "default"
