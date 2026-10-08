# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Flush the outbox: offer every queued memory write as a private card proposal (ADR-0046).

Runs whenever the plugin has just reached the Worldbuilder (a successful consult, a successful
memory routing). For each entry, oldest first:

1. ``memory_route`` classifies the text. A secret-like text is never sent: the entry becomes
   ``blocked_secret``. If the classifier cannot be reached, the flush stops (nothing unclassified is sent).
2. The entry is marked ``submitting`` *before* the proposal call. ``knowledge_write_back`` has no
   idempotency key, so the card carries the tags ``pending-write-back`` and ``outbox:<id>``; when
   an earlier attempt died with an unknown outcome, the proposals are searched for that tag first
   and an existing one is adopted instead of creating a second.
3. ``knowledge_write_back`` creates the private proposal; the entry becomes ``done`` with the
   proposal id and the write-back receipt id, and its content is removed (a tombstone).

Entries with the same content in one flush are offered once; the others are marked done with the same proposal.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from .cards import card_draft
from .client import Deadline, WorldbuilderClient, WorldbuilderError
from .outbox import MARKER_TAG, Outbox
from .settings import ULID_RE, Settings

logger = logging.getLogger(__name__)

MAX_PER_FLUSH = 25
RETRY_AFTER_FAILURE = 60.0  # seconds before another flush is tried after one that could not reach the service
_LIST_PAGES = 10


@dataclass
class FlushResult:
    proposed: list[str] = field(default_factory=list)  # outbox ids
    blocked: list[str] = field(default_factory=list)
    stopped: str = ""  # why the flush ended early ("" = it ran through)
    remaining: int = 0

    def notice(self) -> str:
        parts = []
        if self.proposed:
            parts.append(
                f"{len(self.proposed)} memory write(s) made while the Worldbuilder was unreachable were "
                "offered as private card proposals (tag pending-write-back); the human reviews them on the board"
            )
        if self.blocked:
            parts.append(
                f"{len(self.blocked)} looked secret-like and were NOT sent ({', '.join(self.blocked)}); "
                "the owner must review them"
            )
        return ("Worldbuilder: " + "; ".join(parts) + ".") if parts else ""


def outbox_tag(outbox_id: str) -> str:
    return f"outbox:{outbox_id}"


class Flusher:
    def __init__(self, client: WorldbuilderClient, settings: Settings, outbox: Outbox) -> None:
        self._client = client
        self._settings = settings
        self._outbox = outbox
        self._running = threading.Lock()
        self._not_before = 0.0

    def has_open(self) -> bool:
        try:
            return any(e["status"] in ("pending", "submitting") for e in self._outbox.entries())
        except OSError:
            return False

    def flush(self, deadline: Deadline | None = None, force: bool = False) -> FlushResult:
        result = FlushResult()
        if not self._running.acquire(blocking=False):
            result.stopped = "another flush is running"
            return result
        try:
            if not force and time.monotonic() < self._not_before:
                result.stopped = "backing off after a failed flush"
                return result
            try:
                return self._run(result, deadline or Deadline(20.0))
            except OSError as exc:
                logger.warning("worldbuilder-knowledge-loop: cannot use the outbox (%s)", type(exc).__name__)
                result.stopped = "outbox unreadable"
                return result
        finally:
            self._running.release()

    # --- internals ------------------------------------------------------------------------------

    def _run(self, result: FlushResult, deadline: Deadline) -> FlushResult:
        entries = [e for e in self._outbox.entries() if e["status"] in ("pending", "submitting")]
        entries.sort(key=lambda e: (e.get("createdAt", ""), e["outboxId"]))
        offered: dict[str, tuple[str, str | None]] = {}  # contentHash -> (proposalId, receiptId) in this run
        for index, entry in enumerate(entries):
            if index >= MAX_PER_FLUSH:
                result.stopped = "batch limit"
                break
            try:
                self._one(entry, offered, result, deadline)
            except WorldbuilderError as exc:
                self._not_before = time.monotonic() + RETRY_AFTER_FAILURE
                result.stopped = exc.kind
                # ids and kinds only, never the text
                logger.warning("worldbuilder-knowledge-loop: flush stopped (%s)", exc.kind)
                break
        result.remaining = len([e for e in self._outbox.entries() if e["status"] in ("pending", "submitting")])
        return result

    def _one(
        self,
        entry: dict[str, Any],
        offered: dict[str, tuple[str, str | None]],
        result: FlushResult,
        deadline: Deadline,
    ) -> None:
        outbox_id = entry["outboxId"]
        content = entry.get("content")
        if not isinstance(content, str) or not content.strip():
            # An open entry without content cannot be offered: surface it instead of dropping it.
            self._outbox.mark_blocked_secret(outbox_id, "no_content")
            result.blocked.append(outbox_id)
            return
        digest = entry.get("contentHash", "")
        if digest in offered:
            proposal_id, receipt_id = offered[digest]
            self._outbox.mark_done(outbox_id, proposal_id, receipt_id)
            result.proposed.append(outbox_id)
            return

        routed = self._client.call("memory_route", {"text": content[:4000]}, deadline)
        if routed.get("ruleId") == "secret" or "secret_like" in (routed.get("signals") or []):
            self._outbox.mark_blocked_secret(outbox_id, "secret")
            result.blocked.append(outbox_id)
            return

        if entry["status"] == "submitting":
            found = self._find_existing(outbox_id, deadline)
            if found is not None:
                self._outbox.mark_done(outbox_id, found, None)
                offered[digest] = (found, None)
                result.proposed.append(outbox_id)
                return
        else:
            self._outbox.mark_submitting(outbox_id)

        draft = card_draft(content, self._settings.world_id)
        draft["tags"] = [MARKER_TAG, outbox_tag(outbox_id)]
        reply = self._client.call(
            "knowledge_write_back",
            {
                "taskRef": entry["taskRef"],
                "card": draft,
                "rationale": (
                    f"Pending write-back: a memory write of {entry.get('createdAt', '?')} made while the "
                    f"Worldbuilder was unreachable (outbox {outbox_id})."
                ),
            },
            deadline,
        )
        receipt, proposal = reply.get("receipt"), reply.get("proposal")
        if (
            not isinstance(receipt, dict)
            or receipt.get("result") != "proposed"
            or not isinstance(proposal, dict)
            or not ULID_RE.match(str(proposal.get("id", "")))
        ):
            raise WorldbuilderError("malformed", "knowledge_write_back: no proposal in the result")
        receipt_id = receipt.get("receiptId") if isinstance(receipt.get("receiptId"), str) else None
        self._outbox.mark_done(outbox_id, proposal["id"], receipt_id)
        offered[digest] = (proposal["id"], receipt_id)
        result.proposed.append(outbox_id)

    def _find_existing(self, outbox_id: str, deadline: Deadline) -> str | None:
        """The id of a proposal of an earlier, interrupted attempt of this entry, if there is one."""
        tag = outbox_tag(outbox_id)
        for status in ("pending", "accepted", "rejected"):
            cursor: str | None = None
            for _ in range(_LIST_PAGES):
                request: dict[str, Any] = {"status": status, "limit": 200}
                if cursor:
                    request["cursor"] = cursor
                page = self._client.call("proposal_list", request, deadline)
                for proposal in page.get("proposals") or []:
                    payload = proposal.get("payload") if isinstance(proposal, dict) else None
                    card = payload.get("card") if isinstance(payload, dict) else None
                    if isinstance(card, dict) and tag in (card.get("tags") or []):
                        return str(proposal["id"])
                cursor = page.get("nextCursor")
                if not cursor:
                    break
        return None
