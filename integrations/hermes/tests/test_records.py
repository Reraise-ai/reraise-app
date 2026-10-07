# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Task records written by the plugin (on_session_end, kanban_task_completed, post_tool_call), read
by the real ``wb receipts verify``. Hook payloads: hermes-agent website/docs/user-guide/features/
hooks.md (``on_session_end``, ``kanban_task_completed``, ``post_tool_call``)."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

import pytest
from harness.schema_check import assert_valid
from test_wb_verify import TASK, WB, run_wb

needs_wb = pytest.mark.skipif(WB is None, reason="no wb command line")
REF = "TASK-2026-0042"
LESSON = "Lesson learned: premiums tend to double within a day of the first announcement."


def plugin_module(name: str) -> Any:
    return sys.modules[next(m for m in sys.modules if m.startswith("hermes_plugins.") and m.endswith("." + name))]


@pytest.fixture
def records(tmp_path: Path, make_world):  # type: ignore[no-untyped-def]
    folder = tmp_path / "records"
    wb, hermes = make_world(settings={"task_records_dir": str(folder), "agent": "agent:orchestrator"})
    # the fake service runs on a simulated clock; the plugin must stamp records on the same one
    for module in ("session", "records"):
        plugin_module(module).utc_now = wb.now
    return wb, hermes, folder


def files(folder: Path) -> list[Path]:
    return sorted(p for p in folder.glob("*.json"))


def verify(folder: Path, wb) -> Any:  # type: ignore[no-untyped-def]
    return run_wb("receipts", "verify", str(folder), "--log", str(wb.log_path), "--json")


def test_a_finished_task_leaves_a_valid_record_with_the_receipts_known(records) -> None:  # type: ignore[no-untyped-def]
    wb, hermes, folder = records
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    wb.tick(20)
    assert hermes.pre_tool_call("memory", {"target": "memory", "action": "add", "content": LESSON}).blocked
    wb.tick(20)
    hermes.on_session_end()
    (path,) = files(folder)
    assert path.name == f"{REF}.json"
    record = json.loads(path.read_text(encoding="utf-8"))
    assert_valid("task-record.schema.json", record)
    assert record["agent"] == "agent:orchestrator" and record["taskRef"] == REF
    assert record["knowledgeReceipt"]["receiptId"] == wb.receipts[0]["receiptId"]
    assert record["writeBackReceipt"]["receiptId"] == wb.receipts[-1]["receiptId"]


@needs_wb
def test_the_verifier_accepts_a_record_the_plugin_wrote(records) -> None:  # type: ignore[no-untyped-def]
    wb, hermes, folder = records
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    wb.tick(20)
    hermes.pre_tool_call("memory", {"target": "memory", "action": "add", "content": LESSON})
    wb.tick(20)
    hermes.on_session_end()
    result = verify(folder, wb)
    assert result.returncode == 0, result.stdout + result.stderr


@needs_wb
def test_a_task_that_never_consulted_still_gets_a_record_and_fails_verification(records) -> None:  # type: ignore[no-untyped-def]
    wb, hermes, folder = records
    wb.reachable = False
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    wb.tick(20)
    hermes.on_session_end()
    (path,) = files(folder)
    assert "knowledgeReceipt" not in json.loads(path.read_text(encoding="utf-8"))
    assert verify(folder, wb).returncode == 1  # missing, not invisible


def test_an_interrupted_session_writes_no_record(records) -> None:  # type: ignore[no-untyped-def]
    _, hermes, folder = records
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    hermes.on_session_end(completed=False, interrupted=True)
    assert files(folder) == []


def test_later_turns_overwrite_the_one_record_of_the_task(records) -> None:  # type: ignore[no-untyped-def]
    wb, hermes, folder = records
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    hermes.on_session_end()
    wb.tick(30)
    hermes.pre_tool_call("memory", {"target": "memory", "action": "add", "content": LESSON})
    hermes.on_session_end()
    (path,) = files(folder)
    assert "writeBackReceipt" in json.loads(path.read_text(encoding="utf-8"))
    assert [p.name for p in folder.iterdir()] == [path.name]  # no temporary files left


RECEIPT_SHAPES = {
    "plain": lambda r, p: json.dumps({"receipt": r, "proposal": p}),
    "result string": lambda r, p: json.dumps({"result": json.dumps({"receipt": r})}),
    "structured": lambda r, p: json.dumps({"structuredContent": {"receipt": r}, "result": "text"}),
}


@pytest.mark.parametrize("shape", sorted(RECEIPT_SHAPES))
def test_a_write_back_the_model_made_itself_is_noted(records, shape: str) -> None:  # type: ignore[no-untyped-def]
    wb, hermes, folder = records
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    args = {"taskRef": REF, "notNeeded": {"reason": "no_new_knowledge"}}
    envelope = hermes.ctx.call_mcp("worldbuilder", "knowledge_write_back", args)
    receipt = wb.receipts[-1]
    assert envelope["ok"]
    hermes.post_tool_call("mcp__worldbuilder__knowledge_write_back", args, RECEIPT_SHAPES[shape](receipt, None))
    hermes.on_session_end()
    record = json.loads(files(folder)[0].read_text(encoding="utf-8"))
    assert record["writeBackReceipt"] == {"receiptId": receipt["receiptId"], "hash": receipt["hash"]}


def test_a_receipt_of_another_task_or_tool_is_not_taken(records) -> None:  # type: ignore[no-untyped-def]
    wb, hermes, folder = records
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    hermes.ctx.call_mcp(
        "worldbuilder", "knowledge_write_back", {"taskRef": "OTHER-1", "notNeeded": {"reason": "no_new_knowledge"}}
    )
    other = wb.receipts[-1]
    hermes.post_tool_call("mcp__worldbuilder__knowledge_write_back", {}, json.dumps({"receipt": other}))
    hermes.post_tool_call("mcp__other__knowledge_write_back", {}, json.dumps({"receipt": wb.receipts[0]}))
    hermes.post_tool_call("mcp__worldbuilder__knowledge_write_back", {}, "not json")
    hermes.on_session_end()
    assert "writeBackReceipt" not in json.loads(files(folder)[0].read_text(encoding="utf-8"))


def test_kanban_task_completed_writes_the_workers_record(records) -> None:  # type: ignore[no-untyped-def]
    wb, hermes, folder = records
    hermes.pre_llm_call(session_id="worker-1", user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    hermes.kanban_task_completed(task_id="t_9f3a")
    (path,) = files(folder)
    assert json.loads(path.read_text(encoding="utf-8"))["knowledgeReceipt"]["receiptId"] == wb.receipts[0]["receiptId"]


def test_the_default_folder_is_under_hermes_home(tmp_path, monkeypatch, make_world) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hh"))
    wb, hermes = make_world()
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    hermes.on_session_end()
    assert (tmp_path / "hh" / "worldbuilder" / "task-records" / f"{REF}.json").is_file()


def test_an_unwritable_folder_is_logged_and_never_raised(tmp_path, make_world, caplog) -> None:  # type: ignore[no-untyped-def]
    blocker = tmp_path / "file"
    blocker.write_text("x", encoding="utf-8")
    _, hermes = make_world(settings={"task_records_dir": str(blocker / "sub")})
    hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    with caplog.at_level(logging.WARNING):
        hermes.on_session_end()
    assert "cannot write the task record" in caplog.text


# --- the session store ------------------------------------------------------------------------------


def test_the_store_evicts_the_least_recently_used_and_expired_sessions() -> None:
    session = plugin_module("session")
    store = session.SessionStore(max_entries=3, ttl_seconds=3600)
    for name in ("a", "b", "c"):
        store.put(name, session.TaskState(task_ref=name))
    assert store.get("a") is not None  # a is now the most recently used
    store.put("d", session.TaskState(task_ref="d"))
    assert store.get("b") is None and {k for k, _ in store.items()} == {"a", "c", "d"}

    short = session.SessionStore(max_entries=10, ttl_seconds=0.0)
    short.put("x", session.TaskState(task_ref="x"))
    assert short.get("x") is None  # expired at once


def test_a_malformed_card_in_a_package_does_not_break_the_summary(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    original = wb._tool_knowledge_consult

    def consult(arguments):  # type: ignore[no-untyped-def]
        result = original(arguments)
        result["package"]["items"] = ["a string", {"card": "not a dict"}, {"card": None}]
        return result

    wb._tool_knowledge_consult = consult  # type: ignore[method-assign]
    context = hermes.pre_llm_call(user_message=f"Task ref: {REF}\n{TASK}", is_first_turn=True)
    assert context and "Knowledge receipt:" in context
