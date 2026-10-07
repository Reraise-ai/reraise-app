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
from dataclasses import dataclass, field
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


def explicit_task_ref(text: str) -> str | None:
    match = _TASK_REF_LINE.search(text)
    if not match:
        return None
    ref = match.group(1)
    return ref if TASK_REF_RE.match(ref) else None


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


@dataclass
class TaskState:
    task_ref: str
    task_text: str = ""  # the text the consult was asked with; retries ask the same question
    consult: ConsultInfo | None = None
    failure: str | None = None  # why there is no receipt, shown every turn until a consult works
    delegations: int = 0
    write_back: dict[str, str] | None = None  # {receiptId, hash} of the last write-back the plugin made

    @property
    def needs_consult(self) -> bool:
        return self.consult is None or self.consult.result == "confirmation_required"


@dataclass
class SessionStore:
    _states: dict[str, TaskState] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def get(self, key: str) -> TaskState | None:
        with self._lock:
            return self._states.get(key)

    def put(self, key: str, state: TaskState) -> None:
        with self._lock:
            self._states[key] = state

    def key(self, session_id: str = "", task_id: str = "") -> str:
        return session_id or task_id or "default"
