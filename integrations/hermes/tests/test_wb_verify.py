# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""What the plugin produces is accepted, and what it prevents is rejected, by the REAL verifier.

The fake Worldbuilder writes the receipt log in the real hash-chained format; the plugin drives a
task through consult and write-back; the task record built from the hand-off is checked with the
real ``wb receipts verify`` (packages/knowledge-loop, ADR-0040). Skipped when no ``wb`` is
available: set ``WB_BIN`` or build ``packages/knowledge-loop`` (CI does).
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from harness.fake_worldbuilder import FakeWorldbuilder
from harness.schema_check import REPO_ROOT

pytestmark = pytest.mark.needs_wb

TASK = "Assess whether tankers reroute around the Cape for the transit restrictions in Q4"


def _wb_command() -> list[str] | None:
    if os.environ.get("WB_BIN"):
        return shlex.split(os.environ["WB_BIN"])
    bin_js = REPO_ROOT / "packages" / "knowledge-loop" / "dist" / "bin.js"
    if bin_js.is_file() and shutil.which("node"):
        return ["node", str(bin_js)]
    return None


WB = _wb_command()
needs_wb = pytest.mark.skipif(WB is None, reason="no wb command line (set WB_BIN or build packages/knowledge-loop)")


def run_wb(*args: str) -> subprocess.CompletedProcess[str]:
    assert WB is not None
    return subprocess.run([*WB, *args], capture_output=True, text=True, timeout=60, check=False)


def drive_task(wb: FakeWorldbuilder, hermes: Any, ref: str, *, write_back: bool = True) -> dict[str, Any]:
    """consult through the plugin, the task, write-back through the tool; returns the hand-off."""
    context = hermes.pre_llm_call(user_message=f"Task ref: {ref}\n{TASK}", is_first_turn=True)
    assert context and "Knowledge receipt:" in context
    knowledge = wb.receipts[-1]
    handoff: dict[str, Any] = {"taskRef": ref, "agent": wb.agent, "knowledge": knowledge}
    wb.tick(20)
    if write_back:
        envelope = hermes.ctx.call_mcp(
            "worldbuilder", "knowledge_write_back", {"taskRef": ref, "notNeeded": {"reason": "no_new_knowledge"}}
        )
        assert envelope["ok"]
        handoff["writeBack"] = wb.receipts[-1]
    wb.tick(20)
    handoff["completedAt"] = wb.now()
    return handoff


def task_record(handoff: dict[str, Any], **overrides: Any) -> str:
    knowledge, write_back = handoff["knowledge"], handoff.get("writeBack")
    front: dict[str, Any] = {
        "taskRef": handoff["taskRef"],
        "agent": handoff["agent"],
        "completedAt": handoff["completedAt"],
        "knowledgeReceipt": {"receiptId": knowledge["receiptId"], "hash": knowledge["hash"]},
    }
    if write_back is not None:
        front["writeBackReceipt"] = {"receiptId": write_back["receiptId"], "hash": write_back["hash"]}
    front.update(overrides)
    return "---\n" + json.dumps(front, indent=2) + "\n---\n\nHand-off notes.\n"


def verify(tmp_path: Path, wb: FakeWorldbuilder, *records: str) -> subprocess.CompletedProcess[str]:
    directory = tmp_path / "tasks"
    shutil.rmtree(directory, ignore_errors=True)
    directory.mkdir()
    for index, text in enumerate(records):
        (directory / f"task-{index}.md").write_text(text, encoding="utf-8")
    return run_wb("receipts", "verify", str(directory), "--log", str(wb.log_path), "--json")


@needs_wb
def test_a_task_driven_through_the_plugin_verifies(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    handoff = drive_task(wb, hermes, "TASK-2026-0042")
    result = verify(tmp_path, wb, task_record(handoff))
    assert result.returncode == 0, result.stdout + result.stderr


@needs_wb
def test_a_card_written_from_memory_is_the_tasks_write_back(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    ref = "TASK-2026-0043"
    hermes.pre_llm_call(user_message=f"Task ref: {ref}\n{TASK}", is_first_turn=True)
    wb.tick(20)
    decision = hermes.pre_tool_call(
        "memory",
        {"target": "memory", "action": "add", "content": "Lesson learned: premiums tend to double within a day."},
    )
    assert decision.blocked
    wb.tick(20)
    handoff = {
        "taskRef": ref,
        "agent": wb.agent,
        "knowledge": wb.receipts[0],
        "writeBack": wb.receipts[-1],
        "completedAt": wb.now(),
    }
    assert handoff["writeBack"]["result"] == "proposed"
    result = verify(tmp_path, wb, task_record(handoff))
    assert result.returncode == 0, result.stdout + result.stderr


@needs_wb
def test_work_without_a_write_back_receipt_is_rejected(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    handoff = drive_task(wb, hermes, "TASK-2026-0044", write_back=False)
    result = verify(tmp_path, wb, task_record(handoff))
    assert result.returncode == 1
    assert "missing" in result.stdout


@needs_wb
def test_a_failed_consult_means_no_receipt_and_the_task_fails(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    wb.reachable = False
    context = hermes.pre_llm_call(user_message=f"Task ref: TASK-2026-0045\n{TASK}", is_first_turn=True)
    assert context and "consult FAILED" in context
    wb.reachable = True
    # the agent, told it has no receipt, still hands off: with nothing it can cite honestly
    record = (
        "---\ntaskRef: TASK-2026-0045\nagent: agent:orchestrator\ncompletedAt: 2026-10-05T09:30:00Z\n---\n\nnotes\n"
    )
    result = verify(tmp_path, wb, record)
    assert result.returncode == 1 and "missing" in result.stdout


@needs_wb
def test_an_invented_receipt_is_rejected(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    handoff = drive_task(wb, hermes, "TASK-2026-0046")
    fake_hash = "sha256:" + "ab" * 32
    forged = task_record(handoff, knowledgeReceipt={"receiptId": handoff["knowledge"]["receiptId"], "hash": fake_hash})
    invented = task_record(handoff, knowledgeReceipt={"receiptId": "01M1ZZ00000000000000000000", "hash": fake_hash})
    assert "forged" in verify(tmp_path, wb, forged).stdout
    assert "unknown" in verify(tmp_path, wb, invented).stdout


@needs_wb
def test_another_tasks_receipts_cannot_be_reused(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    first = drive_task(wb, hermes, "TASK-2026-0047")
    second = {**drive_task(wb, hermes, "TASK-2026-0048")}
    stolen = task_record(
        second, knowledgeReceipt={"receiptId": first["knowledge"]["receiptId"], "hash": first["knowledge"]["hash"]}
    )
    result = verify(tmp_path, wb, stolen)
    assert result.returncode == 1 and "wrong_task" in result.stdout


@needs_wb
def test_a_tampered_receipt_log_is_detected(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    handoff = drive_task(wb, hermes, "TASK-2026-0049")
    lines = wb.log_path.read_text(encoding="utf-8").splitlines()
    entry = json.loads(lines[0])
    entry["receipt"]["agent"] = "agent:someone-else"
    lines[0] = json.dumps(entry, separators=(",", ":"))
    wb.log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result = verify(tmp_path, wb, task_record(handoff))
    assert result.returncode == 3


@needs_wb
def test_metrics_count_the_plugin_driven_tasks(world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    records = tmp_path / "metric-tasks"
    records.mkdir()
    for number in (1, 2):
        handoff = drive_task(wb, hermes, f"TASK-2026-01{number}0")
        (records / f"t{number}.md").write_text(task_record(handoff), encoding="utf-8")
    result = run_wb(
        "metrics",
        "--log",
        str(wb.log_path),
        "--tasks",
        str(records),
        "--proposals",
        str(tmp_path / "none"),
        "--now",
        "2026-10-06T00:00:00Z",
        "--json",
    )
    assert result.returncode == 0, result.stdout + result.stderr
    totals = json.loads(result.stdout)["totals"]
    assert totals["tasks"] == 2 and totals["tasksWithReceipts"] == 2 and totals["receiptCoverage"] == 1
