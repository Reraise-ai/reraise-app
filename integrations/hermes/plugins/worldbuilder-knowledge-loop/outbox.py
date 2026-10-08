# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""The durable, owner-only outbox of memory writes made while the Worldbuilder was unreachable
(ADR-0046).

``$HERMES_HOME/worldbuilder/pending-write-back.jsonl``: one JSON object per line, one line per entry,
mode 0600 in a 0700 folder. The content of a memory write stays on this device in this file only.
An entry is ``pending`` (not yet offered), ``submitting`` (a proposal call was started, the outcome
unknown), ``done`` (offered as a card proposal; a tombstone without content), ``blocked_secret``
(the classifier found it secret-like: never sent, surfaced every night) or ``dismissed`` (the owner
dealt with a blocked entry; a tombstone without content).

Standard library only, no relative imports: the plugin imports it, and the nightly job runs it
as a script (``python outbox.py check``) without Hermes, without the Worldbuilder and without ``wb``.

* append: one ``O_APPEND`` write of a whole line under an exclusive file lock, then fsync;
* update: the file is rewritten as a whole (temporary file in the same folder, fsync, atomic
  replace) under the same lock, so a crash leaves the old or the new file, never half of one;
* lines that cannot be read are kept as they are on every rewrite and counted as a fault.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import secrets
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

try:  # POSIX
    import fcntl  # type: ignore[import-not-found,unused-ignore]
except ImportError:  # Windows
    fcntl = None  # type: ignore[assignment,unused-ignore]
try:
    import msvcrt  # type: ignore[import-not-found,unused-ignore]
except ImportError:
    msvcrt = None  # type: ignore[assignment,unused-ignore]

FILE_NAME = "pending-write-back.jsonl"
MARKER_TAG = "pending-write-back"
MAX_AGE_HOURS = 24.0
OPEN_STATUSES = ("pending", "submitting")
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_PROCESS_LOCK = threading.RLock()


def default_path() -> str:
    home = os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")
    return os.path.join(home, "worldbuilder", FILE_NAME)


def new_outbox_id(now_ms: int | None = None) -> str:
    """A ULID: 48 bits of milliseconds and 80 random bits in Crockford base 32 (26 characters)."""
    millis = int(time.time() * 1000) if now_ms is None else now_ms
    value = (millis << 80) | secrets.randbits(80)
    return "".join(_CROCKFORD[(value >> (5 * i)) & 31] for i in reversed(range(26)))


def content_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def marker(outbox_id: str) -> str:
    return f"[pending write-back {outbox_id}]"


def _stamp(moment: datetime | None = None) -> str:
    return (moment or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_time(value: Any) -> datetime | None:
    try:
        return datetime.strptime(str(value), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError:
        return None


class Outbox:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or default_path()

    # --- locking and low-level file access --------------------------------------------------

    def _ensure_dir(self) -> None:
        folder = os.path.dirname(self.path) or "."
        os.makedirs(folder, mode=0o700, exist_ok=True)

    @contextlib.contextmanager
    def _locked(self) -> Iterator[None]:
        self._ensure_dir()
        with _PROCESS_LOCK:
            fd = os.open(self.path + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
            try:
                if fcntl is not None:
                    fcntl.flock(fd, fcntl.LOCK_EX)
                elif msvcrt is not None:  # pragma: no cover - Windows
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
                yield
            finally:
                with contextlib.suppress(OSError):
                    if fcntl is not None:
                        fcntl.flock(fd, fcntl.LOCK_UN)
                    elif msvcrt is not None:  # pragma: no cover - Windows
                        os.lseek(fd, 0, os.SEEK_SET)
                        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                os.close(fd)

    def _read_raw(self) -> tuple[list[dict[str, Any]], list[str]]:
        """(entries, unreadable lines). A missing file is an empty outbox."""
        try:
            with open(self.path, encoding="utf-8") as handle:
                lines = handle.read().splitlines()
        except FileNotFoundError:
            return [], []
        entries: list[dict[str, Any]] = []
        bad: list[str] = []
        for line in lines:
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except ValueError:
                bad.append(line)
                continue
            if isinstance(value, dict) and isinstance(value.get("outboxId"), str) and value.get("status"):
                entries.append(value)
            else:
                bad.append(line)
        return entries, bad

    def _write_all(self, entries: list[dict[str, Any]], bad: list[str]) -> None:
        folder = os.path.dirname(self.path) or "."
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".pending-", suffix=".tmp")  # mkstemp: mode 0600
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                for line in bad:
                    handle.write(line + "\n")
                for entry in entries:
                    handle.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise

    def _tighten(self) -> None:
        if os.name == "posix":
            with contextlib.suppress(OSError):
                os.chmod(self.path, 0o600)

    # --- the operations -----------------------------------------------------------------------

    def append(self, agent: str, task_ref: str, content: str, now: datetime | None = None) -> dict[str, Any]:
        """Queue one memory write. Raises OSError when it cannot be made durable."""
        entry = {
            "v": 1,
            "outboxId": new_outbox_id(int((now or datetime.now(UTC)).timestamp() * 1000)),
            "agent": agent,
            "taskRef": task_ref,
            "createdAt": _stamp(now),
            "contentHash": content_hash(content),
            "status": "pending",
            "content": content,
        }
        line = (json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        with self._locked():
            fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                written = os.write(fd, line)
                if written != len(line):  # pragma: no cover - a short write on a local file
                    raise OSError("short write to the outbox")
                os.fsync(fd)
            finally:
                os.close(fd)
            self._tighten()
        return entry

    def entries(self) -> list[dict[str, Any]]:
        with self._locked():
            return self._read_raw()[0]

    def faults(self) -> int:
        with self._locked():
            return len(self._read_raw()[1])

    def update(self, outbox_id: str, **changes: Any) -> bool:
        """Apply ``changes`` to one entry. ``content=None`` removes the content (a tombstone)."""
        with self._locked():
            entries, bad = self._read_raw()
            found = False
            for entry in entries:
                if entry["outboxId"] == outbox_id:
                    found = True
                    for key, value in changes.items():
                        if value is None:
                            entry.pop(key, None)
                        else:
                            entry[key] = value
                    entry["updatedAt"] = _stamp()
            if found:
                self._write_all(entries, bad)
                self._tighten()
            return found

    def mark_submitting(self, outbox_id: str) -> bool:
        return self.update(outbox_id, status="submitting")

    def mark_done(self, outbox_id: str, proposal_id: str, receipt_id: str | None) -> bool:
        return self.update(outbox_id, status="done", proposalId=proposal_id, receiptId=receipt_id, content=None)

    def mark_blocked_secret(self, outbox_id: str, rule_id: str) -> bool:
        return self.update(outbox_id, status="blocked_secret", ruleId=rule_id)

    def dismiss(self, outbox_id: str) -> bool:
        return self.update(outbox_id, status="dismissed", content=None)

    # --- reporting ------------------------------------------------------------------------------

    def summary(self, max_age_hours: float = MAX_AGE_HOURS, now: datetime | None = None) -> dict[str, Any]:
        moment = now or datetime.now(UTC)
        entries = self.entries()
        pending = [e for e in entries if e["status"] in OPEN_STATUSES]
        blocked = [e for e in entries if e["status"] == "blocked_secret"]

        def age_hours(entry: dict[str, Any]) -> float:
            created = _parse_time(entry.get("createdAt"))
            # An unreadable time is treated as very old: it must be seen, not ignored.
            return (moment - created).total_seconds() / 3600 if created else float("inf")

        stale = [e for e in pending + blocked if age_hours(e) > max_age_hours]
        return {
            "pending": [e["outboxId"] for e in pending],
            "blocked": [e["outboxId"] for e in blocked],
            "stale": [e["outboxId"] for e in stale],
            "oldestAgeHours": max((age_hours(e) for e in pending + blocked), default=0.0),
            "faults": self.faults(),
        }


def render_report(summary: dict[str, Any], max_age_hours: float) -> str:
    """The text of the nightly check. Ids and counts only, never the content of an entry."""
    lines = []
    if summary["pending"] or summary["blocked"]:
        lines.append(
            f"Worldbuilder pending write-back: {len(summary['pending'])} pending, "
            f"{len(summary['blocked'])} blocked as secret-like."
        )
    if summary["pending"]:
        lines.append(
            "pending (memory writes made while the Worldbuilder was unreachable, not yet offered as card "
            "proposals): " + ", ".join(summary["pending"])
        )
    if summary["blocked"]:
        lines.append(
            "blocked as secret-like (never sent; review them in the outbox file and dismiss with "
            "`outbox.py dismiss <id>`): " + ", ".join(summary["blocked"])
        )
    if summary["stale"]:
        lines.append(
            f"{len(summary['stale'])} entr{'y is' if len(summary['stale']) == 1 else 'ies are'} older than "
            f"{max_age_hours:g} h and still not flushed: the Worldbuilder has not been reached by this agent "
            "since, or its flush keeps failing."
        )
    if summary["faults"]:
        lines.append(f"{summary['faults']} unreadable line(s) in the outbox file: it must be repaired by hand.")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    """``outbox.py check|status|dismiss [--file F] [--max-age-hours N] [id]``.

    check: silent when there is nothing to report; otherwise the report. Exit 0 nothing stale,
    4 an entry older than the limit is still not flushed, 2 the outbox cannot be read.
    status: the same report plus a line when all is empty; always exit 0 (2 when unreadable).
    """
    args = list(argv)
    path: str | None = None
    max_age = MAX_AGE_HOURS
    rest: list[str] = []
    while args:
        item = args.pop(0)
        if item == "--file" and args:
            path = args.pop(0)
        elif item == "--max-age-hours" and args:
            try:
                max_age = float(args.pop(0))
            except ValueError:
                print("outbox.py: --max-age-hours is not a number", file=sys.stderr)
                return 2
        else:
            rest.append(item)
    command = rest[0] if rest else "check"
    outbox = Outbox(path)
    try:
        if command == "dismiss":
            if len(rest) != 2:
                print("usage: outbox.py dismiss <outboxId>", file=sys.stderr)
                return 2
            entry = next((e for e in outbox.entries() if e["outboxId"] == rest[1]), None)
            if entry is None or entry["status"] != "blocked_secret":
                print("outbox.py: no blocked entry with that id", file=sys.stderr)
                return 2
            outbox.dismiss(rest[1])
            print(f"dismissed {rest[1]} (content removed)")
            return 0
        if command not in ("check", "status"):
            print(f"outbox.py: unknown command {command}", file=sys.stderr)
            return 2
        summary = outbox.summary(max_age)
    except OSError as exc:
        print(f"outbox.py: cannot read the outbox ({type(exc).__name__})", file=sys.stderr)
        return 2
    report = render_report(summary, max_age)
    if report:
        print(report)
    elif command == "status":
        print("Worldbuilder pending write-back: nothing pending, nothing blocked.")
    if summary["faults"]:
        return 2
    return 4 if (command == "check" and summary["stale"]) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
