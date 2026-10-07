# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""A fake Worldbuilder MCP responder for the Hermes integration tests.

THE SEAM: the MCP server side of the five knowledge-loop tools (knowledge_consult,
knowledge_write_back, decision_record, decision_outcome, memory_route) is wired in the service
slice (packages/mcp-server defines the tools; services/api serves them on /mcp). Until then this
fake stands in. It is held to the contract, not to the implementation:

* every request is validated against the repository's JSON Schemas (``consultRequest``,
  write-back ``request``, memory-route ``request``); an invalid request is a tool error, so a plugin
  that sends a wrong argument fails here;
* every result is validated against its output schema before it is returned, and receipts carry
  correct JCS hashes and are appended to a hash-chained receipt log in the real log format
  (schemas/receipt-log-entry.schema.json, ADR-0040), so the real ``wb receipts verify`` can be run
  over what the plugin produced (tests/test_wb_verify.py).

Not faithful (and not meant to be): card matching is keyword overlap, the memory classifier is a
tiny stand-in for the ordered rules of ADR-0042, ``draftHash`` is a JCS hash of the draft instead of
the card content hash of ADR-0034, and decision_record / decision_outcome are not implemented.
Passing against this fake proves the plugin honours the contracts; it does not prove the service.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import random
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .fake_hermes import FakeMcpTransport, McpToolError
from .jcs import canonical_json, hash_jcs, with_hash
from .schema_check import assert_valid, errors, fixture

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
GENESIS = "sha256:" + "0" * 64
WORLD_ID = "01M1DZPW00JGXPRPG4179ZPNB8"
LAGE_ID = "01M1F21G80R816A1T0V2P6RACH"

_SECRET = re.compile(r"(?i)\b(password|passphrase|token|secret|api key|bearer)\b[^.;!?]{0,40}(:|=|\bis\b)")
_LOCAL = re.compile(r"(?i)(localhost|\b\d{1,3}(\.\d{1,3}){3}\b|:\d{2,5}\b|(^|\s)/[a-z]+/)")
_TRANSIENT = re.compile(r"(?i)\b(today|yesterday|right now|currently|restart(ed)?|timeout|timed out|retry|cron|exit code)\b")
_DURABLE = re.compile(r"(?i)\b(lesson|learned|always|never|because|tends to|in general|prefers|insight)\b")


class FakeWorldbuilder(FakeMcpTransport):
    def __init__(
        self,
        state_dir: Path,
        *,
        agent: str = "agent:orchestrator",
        target: str = "local_model",
        start: datetime | None = None,
        seed: int = 7,
    ) -> None:
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.state_dir / "receipt-log.jsonl"
        self.agent = agent
        self.target = target
        self.key = hashlib.sha256(b"synthetic device receipt key").digest()
        self._rng = random.Random(seed)
        self._now = start or datetime(2026, 10, 5, 9, 0, 0, tzinfo=timezone.utc)
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.receipts: list[dict[str, Any]] = []
        self.proposals: list[dict[str, Any]] = []
        self.pending_transfer: str | None = None
        self.transfer_confirmed = False
        self.reachable = True
        package = fixture("context-package-screen-with-stance")
        self.cards = [
            {"card": item["card"], "provenance": item["provenance"], "gate": item["gate"]}
            for item in package["items"]
        ]

    # --- clock and ids --------------------------------------------------------------------

    def now(self) -> str:
        return self._now.strftime("%Y-%m-%dT%H:%M:%SZ")

    def tick(self, seconds: int = 5) -> None:
        self._now += timedelta(seconds=seconds)

    def ulid(self) -> str:
        stamp = int(self._now.timestamp() * 1000) + len(self.calls)
        head = "".join(_CROCKFORD[(stamp >> (5 * i)) & 31] for i in reversed(range(10)))
        tail = "".join(self._rng.choice(_CROCKFORD) for _ in range(16))
        return head + tail

    def confirm_transfer(self) -> None:
        """What the human does on the board for a cloud_model connection (ADR-0031)."""
        self.transfer_confirmed = True

    # --- the transport ----------------------------------------------------------------------

    def handle(self, tool: str, arguments: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
        if not self.reachable:
            raise ConnectionError("connection refused")
        self.calls.append((tool, json.loads(json.dumps(arguments))))
        method = getattr(self, f"_tool_{tool}", None)
        if method is None:
            raise McpToolError(f"tool not implemented in the fake responder: {tool}")
        result = method(arguments)
        return json.dumps(result), result

    def tools_called(self) -> list[str]:
        return [name for name, _ in self.calls]

    # --- receipt log ----------------------------------------------------------------------

    def _append_log(self, receipt: dict[str, Any]) -> None:
        lines = self.log_path.read_text(encoding="utf-8").splitlines() if self.log_path.exists() else []
        prev = json.loads(lines[-1])["hash"] if lines else GENESIS
        entry = with_hash({"v": 1, "seq": len(lines), "at": receipt["at"], "prev": prev, "receipt": receipt})
        assert_valid("receipt-log-entry.schema.json", entry)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n")
        self.receipts.append(receipt)

    def _check_request(self, ref: str, arguments: dict[str, Any]) -> None:
        found = errors(ref, arguments)
        if found:
            raise McpToolError("invalid arguments: " + "; ".join(found[:3]))

    # --- knowledge_consult -----------------------------------------------------------------

    def _query_hash(self, task: str) -> str:
        return "hmac-sha256:" + hmac.new(self.key, canonical_json(task).encode("utf-8"), hashlib.sha256).hexdigest()

    def _tool_knowledge_consult(self, arguments: dict[str, Any]) -> dict[str, Any]:
        self._check_request("knowledge-receipt.schema.json#/$defs/consultRequest", arguments)
        self.tick()
        words = {w for w in re.findall(r"[a-z]{4,}", arguments["task"].lower())}
        matched = [
            c
            for c in self.cards
            if words & set(re.findall(r"[a-z]{4,}", (c["card"]["title"] + " " + c["card"].get("body", "")).lower()))
        ][: arguments.get("maxItems", 20)]
        package: dict[str, Any] = {
            "id": self.ulid(),
            "target": self.target,
            "worldId": arguments["worldId"],
            "createdAt": self.now(),
            "items": [],
            "independence": {"findings": 0, "origins": 0},
            "pendingProposals": [],
            "withheld": 0,
        }
        if "lageId" in arguments:
            package["lageId"] = arguments["lageId"]
        receipt: dict[str, Any] = {
            "receiptId": self.ulid(),
            "kind": "knowledge",
            "agent": self.agent,
            "taskRef": arguments["taskRef"],
            "queryHash": self._query_hash(arguments["task"]),
            "worldId": arguments["worldId"],
            "target": self.target,
            "packageId": package["id"],
            "at": self.now(),
        }
        if "lageId" in arguments:
            receipt["lageId"] = arguments["lageId"]

        released = self.target != "cloud_model" or (
            self.transfer_confirmed and arguments.get("transferId") == self.pending_transfer
        )
        if not released:
            if self.pending_transfer is None:
                self.pending_transfer = self.ulid()
            package["withheld"] = len(matched)
            package["confirmationRequired"] = {"transferId": self.pending_transfer}
            package["denied"] = [
                {"cardId": c["card"]["id"], "reason": "cloud_model needs a confirmed transfer"} for c in matched
            ]
            receipt.update(result="confirmation_required", cardIds=[], transferId=self.pending_transfer)
        elif matched:
            package["items"] = matched
            origins = {c["provenance"]["originRoot"] for c in matched}
            package["independence"] = {"findings": len(matched), "origins": len(origins)}
            if self.target == "cloud_model":
                package["transfer"] = {
                    "transferId": self.pending_transfer,
                    "payloadHash": hash_jcs([c["card"]["id"] for c in matched]),
                    "cardIds": [c["card"]["id"] for c in matched],
                    "confirmedAt": self.now(),
                }
            receipt.update(result="cards", cardIds=[c["card"]["id"] for c in matched])
        else:
            receipt.update(result="nothing_found", cardIds=[])
        receipt = with_hash(receipt)
        result = {"package": package, "receipt": receipt}
        assert_valid("knowledge-receipt.schema.json#/$defs/consultResult", result)
        self._append_log(receipt)
        return result

    # --- knowledge_write_back --------------------------------------------------------------

    def _tool_knowledge_write_back(self, arguments: dict[str, Any]) -> dict[str, Any]:
        self._check_request("write-back-receipt.schema.json#/$defs/request", arguments)
        self.tick()
        receipt: dict[str, Any] = {
            "receiptId": self.ulid(),
            "kind": "write_back",
            "agent": self.agent,
            "taskRef": arguments["taskRef"],
            "at": self.now(),
        }
        if "consultReceiptId" in arguments:
            receipt["consultReceiptId"] = arguments["consultReceiptId"]
        proposal = None
        if "card" in arguments:
            proposal = {
                "id": self.ulid(),
                "author": self.agent,
                "kind": "create_card",
                "payload": {"card": arguments["card"]},
                "status": "pending",
                "createdAt": self.now(),
            }
            for key in ("lageId", "x", "y"):
                if key in arguments:
                    proposal["payload"][key] = arguments[key]
            if "rationale" in arguments:
                proposal["rationale"] = arguments["rationale"]
            receipt.update(result="proposed", proposalId=proposal["id"], draftHash=hash_jcs(arguments["card"]))
        else:
            not_needed = arguments["notNeeded"]
            receipt.update(result="not_needed", reason=not_needed["reason"])
            if "coveredBy" in not_needed:
                receipt["coveredBy"] = not_needed["coveredBy"]
        receipt = with_hash(receipt)
        result: dict[str, Any] = {"receipt": receipt}
        if proposal is not None:
            result["proposal"] = proposal
            self.proposals.append(proposal)
        assert_valid("write-back-receipt.schema.json#/$defs/result", result)
        self._append_log(receipt)
        return result

    # --- memory_route (stand-in for the ordered rules of ADR-0042) ---------------------------

    def _tool_memory_route(self, arguments: dict[str, Any]) -> dict[str, Any]:
        self._check_request("memory-route.schema.json#/$defs/request", arguments)
        text = arguments["text"]
        if _SECRET.search(text):
            result = {"route": "ephemeral_ops_fact", "ruleId": "secret", "signals": ["secret_like"]}
        elif _LOCAL.search(text):
            result = {"route": "ephemeral_ops_fact", "ruleId": "local_reference", "signals": ["local_reference"]}
        elif _DURABLE.search(text) and not _TRANSIENT.search(text):
            result = {"route": "card_proposal", "ruleId": "durable_statement", "signals": ["durable"]}
        elif _TRANSIENT.search(text):
            result = {"route": "ephemeral_ops_fact", "ruleId": "transient", "signals": ["transient"]}
        else:
            result = {"route": "ephemeral_ops_fact", "ruleId": "default", "signals": []}
        result["classifier"] = "rules:v2"
        assert_valid("memory-route.schema.json", result)
        return result
