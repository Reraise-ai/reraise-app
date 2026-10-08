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
