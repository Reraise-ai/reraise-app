# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Memory writes made while the Worldbuilder is unreachable (ADR-0046, owner decision 2026-10-08): the write
goes ahead, marked ``[pending write-back <id>]`` and recorded in an owner-only outbox; once the
Worldbuilder answers again every entry is offered as a private card proposal, except secret-like ones.
The modify semantics (keys merged into the tool arguments) are those of hermes-agent
hermes_cli/plugins.py (``_get_pre_tool_call_directive_details``)."""

from __future__ import annotations

import json
import logging
import os
import stat
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from harness.schema_check import assert_valid

LESSON = "Lesson learned: war-risk premiums tend to double within a day of the first transit announcement."
OTHER = "Insight: carriers always reroute before insurers reprice, because rerouting is cheaper."
SECRET = "The staging api key is sk_test_4eC39HqLyjWDarjtT1zdp7dc and the token is abc123"
MARKER = "[pending write-back "


def plugin_module(name: str) -> Any:
    return sys.modules[next(m for m in sys.modules if m.startswith("hermes_plugins.") and m.endswith("." + name))]


def memory(**kw: Any) -> dict[str, Any]:
    return {"target": "memory", **kw}


def entries(hermes: Any) -> list[dict[str, Any]]:
    path: Path = hermes.pending_file
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def reconnect(wb: Any, hermes: Any, ref: str = "TASK-RECONNECT") -> str:
    """The Worldbuilder is back; the agent's next task consults it."""
    wb.reachable = True
    return hermes.pre_llm_call(user_message=f"Task ref: {ref}\ntankers", is_first_turn=True) or ""


# --- queue ------------------------------------------------------------------------------------------


def test_unreachable_memory_write_is_allowed_marked_and_recorded(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON), session_id="s1")
    assert not decision.blocked and decision.modified
    (entry,) = entries(hermes)
    assert decision.args["content"] == f"{MARKER}{entry['outboxId']}] {LESSON}"
    assert decision.args["target"] == "memory" and decision.args["action"] == "add"
    assert entry["status"] == "pending" and entry["content"] == LESSON
    assert entry["agent"] == "agent:hermes" and entry["taskRef"].startswith("memory:")
    assert entry["contentHash"].startswith("sha256:") and entry["createdAt"].endswith("Z")
    assert len(entry["outboxId"]) == 26  # ULID-like
    assert wb.proposals == [] and wb.receipts == []


def test_the_new_text_alias_and_batches_are_marked_item_by_item(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    replaced = hermes.pre_tool_call("memory", memory(action="replace", old_text="x", new_text=LESSON))
    assert replaced.args["new_text"].startswith(MARKER) and "content" not in replaced.args
    ops = [
        {"action": "add", "content": LESSON},
        {"action": "remove", "old_text": "stale"},
        {"action": "add", "content": OTHER},
    ]
    batch = hermes.pre_tool_call("memory", memory(operations=ops))
    out = batch.args["operations"]
    assert out[0]["content"].startswith(MARKER) and out[1] == ops[1] and out[2]["content"].startswith(MARKER)
    ids = [e["outboxId"] for e in entries(hermes)]
    assert len(ids) == 3 and all(i in out[0]["content"] + out[2]["content"] + replaced.args["new_text"] for i in ids)


def test_a_failed_write_back_queues_the_item_and_keeps_proposals_already_made(make_world) -> None:  # type: ignore[no-untyped-def]
    from harness.fake_hermes import McpToolError

    wb, hermes = make_world()
    original = wb._tool_knowledge_write_back
    calls = {"n": 0}

    def flaky(arguments):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        if calls["n"] == 2:
            raise McpToolError("proposal queue full")
        return original(arguments)

    wb._tool_knowledge_write_back = flaky  # type: ignore[method-assign]
    decision = hermes.pre_tool_call(
        "memory", memory(operations=[{"action": "add", "content": LESSON}, {"action": "add", "content": OTHER}])
    )
    assert len(wb.proposals) == 1  # the first item became a proposal and left the memory write
    assert [op["content"] for op in decision.args["operations"]] == [
        f"{MARKER}{entries(hermes)[0]['outboxId']}] {OTHER}"
    ]
    assert [e["content"] for e in entries(hermes)] == [OTHER]


def test_the_model_is_told_on_its_next_turn(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    hermes.pre_llm_call(user_message="Task ref: TASK-1\ntankers", is_first_turn=True)
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = False  # still down: the next turn's consult fails and says so; the notice comes with it
    notice = hermes.pre_llm_call(user_message="next", is_first_turn=False) or ""
    assert "pending write-back" in notice and entries(hermes)[0]["outboxId"] in notice


def test_if_the_outbox_cannot_be_written_the_memory_write_is_blocked(make_world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    blocker = tmp_path / "not-a-folder"
    blocker.write_text("x")
    wb, hermes = make_world(settings={"pending_file": str(blocker / "pending.jsonl")})
    wb.reachable = False
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert decision.blocked and "could not be recorded" in (decision.message or "")


def test_block_mode_still_blocks_and_records_nothing(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world(settings={"memory_on_error": "block"})
    wb.reachable = False
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert decision.blocked and "memory write blocked" in (decision.message or "")
    assert entries(hermes) == []


@pytest.mark.parametrize("old", ["allow", "ALLOW", "nonsense"])
def test_the_old_allow_value_means_queue_and_logs_a_deprecation(make_world, caplog, old) -> None:  # type: ignore[no-untyped-def]
    with caplog.at_level(logging.WARNING):
        wb, hermes = make_world(settings={"memory_on_error": old})
    assert "memory_on_error" in caplog.text and ("deprecated" in caplog.text or "unknown" in caplog.text)
    wb.reachable = False
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert decision.modified and decision.args["content"].startswith(MARKER) and len(entries(hermes)) == 1


def test_the_default_is_queue_without_any_setting(make_world, caplog) -> None:  # type: ignore[no-untyped-def]
    with caplog.at_level(logging.WARNING):
        wb, hermes = make_world()
    assert "deprecated" not in caplog.text
    assert plugin_module("settings").Settings().memory_on_error == "queue"


# --- flush ----------------------------------------------------------------------------------------------


def test_reconnect_offers_every_entry_as_a_private_proposal_and_tombstones_them(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    hermes.pre_tool_call("memory", memory(action="add", content=OTHER))
    ids = [e["outboxId"] for e in entries(hermes)]
    context = reconnect(wb, hermes)
    assert len(wb.proposals) == 2
    for proposal, outbox_id in zip(wb.proposals, ids, strict=True):
        card = proposal["payload"]["card"]
        assert proposal["author"] == wb.agent and proposal["status"] == "pending"
        assert card["release"] == "private" and card["training"] is False
        assert card["tags"] == ["pending-write-back", f"outbox:{outbox_id}"]
        assert not card["body"].startswith(MARKER)  # the original text, not the marker
    assert [p["payload"]["card"]["body"] for p in wb.proposals] == [LESSON, OTHER]
    for call_args in [a for t, a in wb.calls if t == "knowledge_write_back"]:
        assert_valid("write-back-receipt.schema.json#/$defs/request", call_args)
    done = entries(hermes)
    assert [e["status"] for e in done] == ["done", "done"]
    for entry, proposal in zip(done, wb.proposals, strict=True):
        assert "content" not in entry and entry["proposalId"] == proposal["id"]  # tombstone, no content
        assert entry["receiptId"] and entry["contentHash"].startswith("sha256:")
    assert "offered as private card proposals" in context


def test_a_second_flush_creates_no_duplicates(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    reconnect(wb, hermes)
    assert len(wb.proposals) == 1
    hermes.pre_llm_call(user_message="Task ref: TASK-3\nagain", is_first_turn=True)
    hermes.pre_llm_call(user_message="and again", is_first_turn=False)
    assert len(wb.proposals) == 1 and wb.tools_called().count("knowledge_write_back") == 1


def test_a_lost_response_does_not_create_a_second_proposal(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = True
    wb.drop_response.append("knowledge_write_back")  # the proposal is created, the answer never arrives
    hermes.pre_llm_call(user_message="Task ref: TASK-A\ntankers", is_first_turn=True)
    assert len(wb.proposals) == 1 and entries(hermes)[0]["status"] == "submitting"
    flusher_now = hermes_flusher(hermes)
    flusher_now._not_before = 0.0
    flusher_now.flush(force=True)
    assert len(wb.proposals) == 1  # found by its outbox tag, adopted
    (entry,) = entries(hermes)
    assert entry["status"] == "done" and entry["proposalId"] == wb.proposals[0]["id"] and "content" not in entry


def hermes_flusher(hermes: Any) -> Any:
    """A second flusher over the same outbox and the same fake Hermes, as a cron-less manual retry would be."""
    settings = plugin_module("settings").load_settings(hermes.ctx)
    client = plugin_module("client").WorldbuilderClient(hermes.ctx, settings)
    return plugin_module("flush").Flusher(client, settings, plugin_module("outbox").Outbox(str(hermes.pending_file)))


def test_identical_entries_in_one_flush_are_offered_once(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    reconnect(wb, hermes)
    assert len(wb.proposals) == 1
    states = entries(hermes)
    assert [e["status"] for e in states] == ["done", "done"] and states[0]["proposalId"] == states[1]["proposalId"]


def test_a_secret_like_entry_is_never_sent_and_is_surfaced(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=SECRET))
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    secret_id = entries(hermes)[0]["outboxId"]
    context = reconnect(wb, hermes)
    assert len(wb.proposals) == 1 and wb.proposals[0]["payload"]["card"]["body"] == LESSON
    # The local service classifies the text (memory_route stores nothing) but no proposal ever carries it.
    sent = json.dumps([args for tool, args in wb.calls if tool == "knowledge_write_back"] + wb.proposals)
    assert "sk_test_" not in sent and "abc123" not in sent
    blocked = next(e for e in entries(hermes) if e["outboxId"] == secret_id)
    assert blocked["status"] == "blocked_secret"
    assert secret_id in context and "NOT sent" in context
    # a blocked entry is not retried on later flushes
    routed_before = wb.tools_called().count("memory_route")
    hermes.pre_llm_call(user_message="Task ref: TASK-B\nagain", is_first_turn=True)
    assert wb.tools_called().count("memory_route") == routed_before  # not classified or retried again


def test_the_flush_stops_when_the_service_goes_away_again_and_sends_nothing_unclassified(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    flusher = hermes_flusher(hermes)
    flusher.flush(force=True)  # still unreachable
    assert wb.calls == [] and entries(hermes)[0]["status"] == "pending"
    wb.reachable = True
    flusher._not_before = 0.0
    flusher.flush(force=True)
    assert entries(hermes)[0]["status"] == "done"


def test_a_successful_memory_routing_also_flushes(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = True
    ops = "Restarted the gateway today because of a timeout; retry worked."
    hermes.pre_tool_call("memory", memory(action="add", content=ops))
    assert [p["payload"]["card"]["body"] for p in wb.proposals] == [LESSON]
    assert entries(hermes)[0]["status"] == "done"


# --- files ----------------------------------------------------------------------------------------------


@pytest.mark.skipif(os.name != "posix", reason="POSIX permissions")
def test_the_outbox_is_owner_only(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert stat.S_IMODE(hermes.pending_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(hermes.pending_file.parent.stat().st_mode) == 0o700
    reconnect(wb, hermes)  # the rewrite keeps the mode
    assert stat.S_IMODE(hermes.pending_file.stat().st_mode) == 0o600
    assert [p for p in hermes.pending_file.parent.iterdir() if p.name.startswith(".pending-")] == []


def test_an_unreadable_line_survives_a_rewrite_and_is_reported(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    with hermes.pending_file.open("a", encoding="utf-8") as handle:
        handle.write("{not json\n")
    reconnect(wb, hermes)
    assert "{not json" in hermes.pending_file.read_text(encoding="utf-8")
    outbox = plugin_module("outbox")
    assert outbox.main(["check", "--file", str(hermes.pending_file)]) == 2


# --- the checker the nightly job runs ----------------------------------------------------------------------


def test_the_checker_counts_and_dates_entries(tmp_path, capsys) -> None:  # type: ignore[no-untyped-def]
    outbox = plugin_module("outbox")
    path = tmp_path / "w" / "pending.jsonl"
    box = outbox.Outbox(str(path))
    old = datetime.now(UTC) - timedelta(hours=30)
    box.append("agent:a", "T-1", "old lesson", now=old)
    fresh = box.append("agent:a", "T-2", "fresh lesson")
    blocked = box.append("agent:a", "T-3", "secret thing")
    box.mark_blocked_secret(blocked["outboxId"], "secret")
    assert outbox.main(["check", "--file", str(path)]) == 4
    out = capsys.readouterr().out
    assert "2 pending, 1 blocked" in out and fresh["outboxId"] in out and "old lesson" not in out
    assert "older than 24 h" in out
    assert outbox.main(["check", "--file", str(path), "--max-age-hours", "100"]) == 0
    assert outbox.main(["dismiss", "--file", str(path), blocked["outboxId"]]) == 0
    assert [e["status"] for e in box.entries() if e["outboxId"] == blocked["outboxId"]] == ["dismissed"]
    assert "content" not in next(e for e in box.entries() if e["outboxId"] == blocked["outboxId"])
    assert outbox.main(["dismiss", "--file", str(path), fresh["outboxId"]]) == 2  # only blocked entries


def test_the_session_end_logs_entries_still_pending(make_world, caplog) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_llm_call(user_message="Task ref: TASK-END\ntankers", is_first_turn=True)
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    with caplog.at_level(logging.WARNING):
        hermes.on_session_end()
    assert "TASK-END ends with 1 pending write-back" in caplog.text and "war-risk" not in caplog.text


def test_a_turn_of_an_already_consulted_task_flushes_what_was_queued_since(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    hermes.pre_llm_call(user_message="Task ref: TASK-L\ntankers", is_first_turn=True)
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = True
    notice = hermes.pre_llm_call(user_message="next", is_first_turn=False) or ""
    assert len(wb.proposals) == 1 and "offered as private card proposals" in notice


def test_the_task_record_lists_pending_entries_and_stays_valid(make_world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    folder = tmp_path / "records"
    wb, hermes = make_world(settings={"task_records_dir": str(folder)})
    wb.reachable = False
    hermes.pre_llm_call(user_message="Task ref: TASK-REC\ntankers", is_first_turn=True)
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    hermes.on_session_end()
    record = json.loads((folder / "TASK-REC.json").read_text(encoding="utf-8"))
    assert_valid("task-record.schema.json", record)
    assert record["pendingWriteBack"] == [entries(hermes)[0]["outboxId"]]
    # once flushed, a later record no longer lists it
    reconnect(wb, hermes, "TASK-REC")
    hermes.on_session_end()
    assert "pendingWriteBack" not in json.loads((folder / "TASK-REC.json").read_text(encoding="utf-8"))


def test_a_queue_made_outside_any_task_still_lets_the_next_turn_consult(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON), session_id="job")
    wb.reachable = True
    context = hermes.pre_llm_call(user_message="summarise tankers", session_id="job", is_first_turn=False) or ""
    assert "Knowledge receipt" in context and len(wb.proposals) == 1


# --- review round: sensitive, empty batch, over-long, faults, locking, deadlines ---------------------------------

EMAIL = "Contact the analyst at jane.roe@example.org about the tanker lessons learned always."
LOCAL_REF = "Lesson learned: the relay on localhost:4310 always drops packets because of the switch."
LONG = ("Lesson learned: premiums tend to double. " * 120)[:4500]


def real_classifier_needed() -> None:
    from harness.fake_worldbuilder import REAL_CLASSIFIER

    if not REAL_CLASSIFIER:
        pytest.skip("needs node and a built packages/knowledge-loop")


@pytest.mark.parametrize("text,rule", [(EMAIL, "personal_data"), (LOCAL_REF, "local_reference")])
def test_personal_data_and_local_references_are_held_not_sent(make_world, text, rule) -> None:  # type: ignore[no-untyped-def]
    real_classifier_needed()
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=text))
    reconnect(wb, hermes)
    assert wb.proposals == [] and "knowledge_write_back" not in wb.tools_called()
    (entry,) = entries(hermes)
    assert entry["status"] == "blocked_sensitive" and entry["ruleId"] == rule


def test_a_secret_signal_alone_blocks_even_when_the_rule_id_is_another(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb._tool_memory_route = lambda a: {  # type: ignore[method-assign]
        "route": "card_proposal",
        "ruleId": "durable_statement",
        "signals": ["secret_like", "durable"],
        "classifier": "rules:v4",
    }
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    reconnect(wb, hermes)
    assert wb.proposals == [] and entries(hermes)[0]["status"] == "blocked_secret"


@pytest.mark.parametrize("signal", ["personal_data", "local_reference"])
def test_a_sensitive_signal_alone_blocks(make_world, signal) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb._tool_memory_route = lambda a: {  # type: ignore[method-assign]
        "route": "card_proposal",
        "ruleId": "durable_statement",
        "signals": [signal],
        "classifier": "rules:v4",
    }
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    reconnect(wb, hermes)
    assert wb.proposals == [] and entries(hermes)[0]["status"] == "blocked_sensitive"


def test_an_empty_operations_list_is_no_batch(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON, operations=[]))
    assert decision.modified and decision.args["content"].startswith(MARKER) and decision.args["operations"] == []
    assert len(entries(hermes)) == 1
    # reachable: a lesson is proposed, not waved through
    wb.reachable = True
    assert hermes.pre_tool_call("memory", memory(action="add", content=OTHER, operations=[])).blocked


def test_the_error_fallback_also_treats_an_empty_list_as_no_batch(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()

    def boom(self, tool, arguments, deadline=None):  # type: ignore[no-untyped-def]
        raise RuntimeError("bug")

    monkeypatch.setattr(plugin_module("client").WorldbuilderClient, "call", boom)
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON, operations=[]))
    assert decision.modified and decision.args["content"].startswith(MARKER)


@pytest.mark.parametrize("reachable", [True, False])
def test_over_long_items_are_marked_held_and_never_sent(make_world, reachable) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = reachable
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LONG))
    assert not decision.blocked and decision.modified and decision.args["content"].startswith(MARKER)
    (entry,) = entries(hermes)
    assert entry["status"] == "blocked_too_long" and entry["content"] == LONG
    assert decision.args["content"] == f"{MARKER}{entry['outboxId']}] {LONG}"
    assert wb.calls == [] and wb.proposals == []
    wb.reachable = True
    reconnect(wb, hermes)  # a flush never touches it and never classifies a part of it
    assert wb.proposals == [] and "memory_route" not in wb.tools_called()
    assert entries(hermes)[0]["status"] == "blocked_too_long"


def test_a_batch_with_a_long_item_marks_it_and_still_routes_the_others(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    ops = [{"action": "add", "content": LONG}, {"action": "add", "content": LESSON}]
    decision = hermes.pre_tool_call("memory", memory(operations=ops))
    assert decision.modified and len(decision.args["operations"]) == 1
    assert decision.args["operations"][0]["content"].startswith(MARKER) and len(wb.proposals) == 1


def test_a_held_item_in_a_blocked_write_leaves_no_entry(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world(settings={"memory_on_error": "block"})
    wb.reachable = False
    decision = hermes.pre_tool_call(
        "memory", memory(operations=[{"action": "add", "content": LONG}, {"action": "add", "content": LESSON}])
    )
    assert decision.blocked
    assert all(e["status"] == "dismissed" and "content" not in e for e in entries(hermes))


def test_a_damaged_entry_becomes_a_fault_and_the_others_are_still_flushed(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    hermes.pre_tool_call("memory", memory(action="add", content=OTHER))
    lines = hermes.pending_file.read_text(encoding="utf-8").splitlines()
    broken = json.loads(lines[0])
    del broken["taskRef"]
    hermes.pending_file.write_text("\n".join([json.dumps(broken), lines[1]]) + "\n", encoding="utf-8")
    reconnect(wb, hermes)
    states = {e["outboxId"]: e for e in entries(hermes)}
    assert states[broken["outboxId"]]["status"] == "fault" and states[broken["outboxId"]]["faultWas"] == "pending"
    assert [p["payload"]["card"]["body"] for p in wb.proposals] == [OTHER]
    outbox = plugin_module("outbox")
    assert outbox.main(["check", "--file", str(hermes.pending_file)]) == 2


def test_a_flush_that_raises_never_changes_the_consult(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))

    def boom(self, deadline=None, force=False):  # type: ignore[no-untyped-def]
        raise RuntimeError("flush bug")

    monkeypatch.setattr(plugin_module("flush").Flusher, "flush", boom)
    wb.reachable = True
    context = hermes.pre_llm_call(user_message="Task ref: TASK-X\ntankers", is_first_turn=True) or ""
    assert "Knowledge receipt:" in context and "FAILED" not in context


def test_a_flush_that_raises_never_changes_the_memory_decision(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))

    def boom(self, deadline=None, force=False):  # type: ignore[no-untyped-def]
        raise RuntimeError("flush bug")

    monkeypatch.setattr(plugin_module("flush").Flusher, "flush", boom)
    wb.reachable = True
    ops = "Restarted the gateway today because of a timeout; retry worked."
    args = memory(action="add", content=ops)
    decision = hermes.pre_tool_call("memory", args)
    assert not decision.blocked and not decision.modified and decision.args == args
    assert len(entries(hermes)) == 1  # nothing queued twice


def test_a_non_worldbuilder_error_in_the_policy_still_queues_and_marks(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()

    def boom(self, tool, arguments, deadline=None):  # type: ignore[no-untyped-def]
        raise RuntimeError("bug")

    monkeypatch.setattr(plugin_module("client").WorldbuilderClient, "call", boom)
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    (entry,) = entries(hermes)
    assert decision.modified and decision.args["content"] == f"{MARKER}{entry['outboxId']}] {LESSON}"


def test_if_the_fallback_cannot_record_either_the_write_is_blocked(make_world, monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    wb, hermes = make_world(settings={"pending_file": str(blocker / "p.jsonl")})

    def boom(self, tool, arguments, deadline=None):  # type: ignore[no-untyped-def]
        raise RuntimeError("bug")

    monkeypatch.setattr(plugin_module("client").WorldbuilderClient, "call", boom)
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert decision.blocked and "could not be recorded" in (decision.message or "")


def test_the_fallback_does_not_queue_items_already_proposed_in_the_same_call(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    real = plugin_module("client").WorldbuilderClient.call
    seen = {"routes": 0}

    def flaky(self, tool, arguments, deadline=None):  # type: ignore[no-untyped-def]
        if tool == "memory_route":
            seen["routes"] += 1
            if seen["routes"] == 2:
                raise RuntimeError("bug")
        return real(self, tool, arguments, deadline)

    monkeypatch.setattr(plugin_module("client").WorldbuilderClient, "call", flaky)
    decision = hermes.pre_tool_call(
        "memory", memory(operations=[{"action": "add", "content": LESSON}, {"action": "add", "content": OTHER}])
    )
    assert len(wb.proposals) == 1
    assert [e["content"] for e in entries(hermes)] == [OTHER]  # not the proposed LESSON
    assert [op["content"] for op in decision.args["operations"]] == [
        f"{MARKER}{entries(hermes)[0]['outboxId']}] {OTHER}"
    ]


def test_two_flushers_create_one_proposal(make_world) -> None:  # type: ignore[no-untyped-def]
    import threading

    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = True
    entered, release = threading.Event(), threading.Event()
    original = wb._tool_knowledge_write_back

    def slow(arguments):  # type: ignore[no-untyped-def]
        entered.set()
        assert release.wait(10)
        return original(arguments)

    wb._tool_knowledge_write_back = slow  # type: ignore[method-assign]
    first, second = hermes_flusher(hermes), hermes_flusher(hermes)  # two instances: two processes
    worker = threading.Thread(target=lambda: first.flush(force=True))
    worker.start()
    assert entered.wait(10)
    skipped = second.flush(force=True)
    release.set()
    worker.join(10)
    assert skipped.stopped == "another process is flushing" and skipped.proposed == []
    assert len(wb.proposals) == 1 and entries(hermes)[0]["status"] == "done"


def test_the_consult_and_the_flush_share_one_deadline(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = True
    seen: list[float] = []
    real = plugin_module("flush").Flusher.flush

    def spy(self, deadline=None, force=False):  # type: ignore[no-untyped-def]
        seen.append(deadline.remaining())
        return real(self, deadline, force)

    monkeypatch.setattr(plugin_module("flush").Flusher, "flush", spy)
    monkeypatch.setattr(plugin_module("consult"), "hook_budget", lambda: 12.0)
    hermes.pre_llm_call(user_message="Task ref: TASK-D\ntankers", is_first_turn=True)
    assert len(seen) == 1 and 0 < seen[0] <= 12.0  # what is left of the turn's 12 s, not a fresh budget


def test_with_no_time_left_in_the_turn_the_flush_waits_and_the_consult_stands(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = True
    monkeypatch.setattr(plugin_module("consult"), "hook_budget", lambda: 2.0)
    context = hermes.pre_llm_call(user_message="Task ref: TASK-E\ntankers", is_first_turn=True) or ""
    assert "Knowledge receipt:" in context and wb.proposals == [] and entries(hermes)[0]["status"] == "pending"


def test_a_lost_answer_is_found_on_a_later_page_of_the_proposal_list(make_world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    monkeypatch.setattr(plugin_module("flush"), "_LIST_LIMIT", 2)
    for n in range(5):  # unrelated proposals in front of ours
        wb.proposals.append(
            {"id": wb.ulid(), "author": wb.agent, "status": "pending", "payload": {"card": {"tags": [f"x{n}"]}}}
        )
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    wb.reachable = True
    wb.drop_response.append("knowledge_write_back")
    hermes.pre_llm_call(user_message="Task ref: TASK-P\ntankers", is_first_turn=True)
    assert len(wb.proposals) == 6
    hermes_flusher(hermes).flush(force=True)
    assert len(wb.proposals) == 6 and entries(hermes)[0]["status"] == "done"


@pytest.mark.skipif(os.name != "posix", reason="POSIX permissions")
def test_loose_existing_files_and_folders_are_tightened(make_world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    folder = hermes.pending_file.parent
    folder.mkdir(parents=True)
    folder.chmod(0o755)
    hermes.pending_file.write_text("")
    hermes.pending_file.chmod(0o666)
    wb.reachable = False
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert stat.S_IMODE(hermes.pending_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(folder.stat().st_mode) == 0o700


@pytest.mark.skipif(os.name != "posix", reason="POSIX permissions")
def test_the_task_record_folders_are_owner_only(make_world, tmp_path) -> None:  # type: ignore[no-untyped-def]
    home = tmp_path / "home" / "worldbuilder"
    (home / "task-records").mkdir(parents=True)
    home.chmod(0o755)
    wb, hermes = make_world(settings={"task_records_dir": str(home / "task-records")})
    hermes.pre_llm_call(user_message="Task ref: TASK-F\ntankers", is_first_turn=True)
    hermes.on_session_end()
    assert stat.S_IMODE(home.stat().st_mode) == 0o700 and stat.S_IMODE((home / "task-records").stat().st_mode) == 0o700
