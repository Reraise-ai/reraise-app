# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""``pre_tool_call`` on ``delegate_task`` (rewrite) and ``kanban_complete`` (block): the mandatory
hand-off fields."""

from __future__ import annotations

import json
import re

import pytest
from harness.fake_worldbuilder import WORLD_ID
from harness.schema_check import assert_valid
from jsonschema import Draft202012Validator

TASK = "Assess whether tankers reroute around the Cape for the transit restrictions in Q4"

# delegate_task arguments: hermes-agent tools/delegate_tool.py (tasks[] of {goal, context, output_schema}).
SPAWN = {"tasks": [{"goal": "Find the insurers' view", "context": "Look at war-risk premiums."}]}


def _contract(decision):  # type: ignore[no-untyped-def]
    assert not decision.blocked, decision.message
    return decision.args["tasks"][0]["output_schema"]


def _handoff(wb) -> dict:  # type: ignore[no-untyped-def]
    """A hand-off as a diligent child would write it from the real tool results."""
    knowledge = next(r for r in wb.receipts if r["kind"] == "knowledge")
    write_back = next(r for r in wb.receipts if r["kind"] == "write_back")
    return {
        "knowledgeReceipt": {"receiptId": knowledge["receiptId"], "hash": knowledge["hash"]},
        "writeBackReceipt": {"receiptId": write_back["receiptId"], "hash": write_back["hash"]},
        "cardWritten": (
            {"proposalId": write_back["proposalId"]}
            if "proposalId" in write_back
            else {"notNeededBecause": write_back["reason"]}
        ),
    }


def test_delegate_task_gets_an_output_schema_requiring_receipts(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_llm_call(user_message=f"Task ref: TASK-2026-0042\n{TASK}", is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", SPAWN)
    assert decision.modified and not decision.blocked
    task = decision.args["tasks"][0]
    # the model's own goal survives; the child's reference leads it
    assert task["goal"] == "Task ref: TASK-2026-0042.s1\n" + SPAWN["tasks"][0]["goal"]
    schema = task["output_schema"]
    assert set(schema["required"]) == {"knowledgeReceipt", "writeBackReceipt", "cardWritten"}
    Draft202012Validator.check_schema(schema)

    # the child is told what to do, with a child task reference derived from the parent's
    assert "Look at war-risk premiums." in task["context"]
    assert "Task ref: TASK-2026-0042.s1" in task["context"]
    assert f"Parent knowledge receipt: {wb.receipts[0]['receiptId']}" in task["context"]
    assert "mcp__worldbuilder__knowledge_consult" in task["context"]


def test_the_child_ref_is_a_valid_task_ref_and_counts_up(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    refs = []
    for _ in range(3):
        decision = hermes.pre_tool_call("delegate_task", SPAWN)
        refs.append(re.search(r"^Task ref: (\S+)$", decision.args["tasks"][0]["context"], re.M).group(1))  # type: ignore[union-attr]
    assert [r.rsplit(".", 1)[1] for r in refs] == ["s1", "s2", "s3"]
    for ref in refs:
        assert re.fullmatch(r"(?!.*//)[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}", ref)


def test_a_conforming_child_answer_validates_and_a_lazy_one_does_not(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    # the child does its two mandatory calls through the same fake service
    hermes.ctx.call_mcp(
        "worldbuilder",
        "knowledge_write_back",
        {"taskRef": "hermes:session-1.s1", "notNeeded": {"reason": "no_new_knowledge"}},
    )
    validator = Draft202012Validator(_contract(hermes.pre_tool_call("delegate_task", SPAWN)))
    good = _handoff(wb)
    assert validator.is_valid({"summary": "done", **good})
    assert not validator.is_valid({"summary": "done"})
    assert not validator.is_valid({**good, "knowledgeReceipt": {"receiptId": "x", "hash": "y"}})
    assert not validator.is_valid({**good, "cardWritten": {"notNeededBecause": "I felt like it"}})
    assert not validator.is_valid({**good, "cardWritten": {}})


def test_the_model_s_own_schema_is_extended_not_replaced(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    mine = {
        "type": "object",
        "properties": {"verdict": {"type": "string"}},
        "required": ["verdict"],
        "additionalProperties": False,
    }
    decision = hermes.pre_tool_call("delegate_task", {"tasks": [{"goal": "g", "output_schema": mine}]})
    schema = _contract(decision)
    assert set(schema["required"]) == {"verdict", "knowledgeReceipt", "writeBackReceipt", "cardWritten"}
    assert "verdict" in schema["properties"] and schema["additionalProperties"] is False
    assert mine == {
        "type": "object",
        "properties": {"verdict": {"type": "string"}},
        "required": ["verdict"],
        "additionalProperties": False,
    }


def test_a_double_encoded_schema_is_understood(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    encoded = json.dumps({"type": "object", "properties": {"verdict": {"type": "string"}}})
    schema = _contract(hermes.pre_tool_call("delegate_task", {"tasks": [{"goal": "g", "output_schema": encoded}]}))
    assert "verdict" in schema["properties"] and "knowledgeReceipt" in schema["properties"]


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "array", "items": {}},
        {"oneOf": [{"type": "object"}, {"type": "null"}]},
        {"$ref": "#/$defs/x"},
        "not json at all",
        42,
    ],
)
def test_a_schema_that_cannot_be_extended_blocks_instead_of_weakening(world, bad) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", {"tasks": [{"goal": "g", "output_schema": bad}]})
    assert decision.blocked and "delegate_task blocked" in (decision.message or "")


def test_every_task_of_a_batch_is_rewritten_with_its_own_child_ref(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", {"tasks": [{"goal": "a"}, {"goal": "b", "context": "c"}]})
    tasks = decision.args["tasks"]
    assert [t["output_schema"]["required"][-1] for t in tasks] == ["cardWritten", "cardWritten"]
    assert "hermes:session-1.s1" in tasks[0]["context"] and "hermes:session-1.s2" in tasks[1]["context"]


def test_the_legacy_single_goal_shape_is_rewritten_at_top_level(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", {"goal": "g", "context": "c"})
    assert (
        decision.args["goal"] == "Task ref: hermes:session-1.s1\ng"
        and "knowledgeReceipt" in decision.args["output_schema"]["properties"]
    )
    assert decision.args["context"].startswith("c\n\nWORLDBUILDER HAND-OFF")


@pytest.mark.parametrize("action", ["list", "steer", "stop"])
def test_control_actions_are_left_alone(world, action) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    args = {"action": action, "subagent_id": "sa-1", "message": "stop that"}
    decision = hermes.pre_tool_call("delegate_task", args)
    assert not decision.blocked and not decision.modified and decision.args == args


def test_a_malformed_call_is_left_for_delegate_task_to_report(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    assert not hermes.pre_tool_call("delegate_task", {"tasks": ["not a dict"]}).modified
    assert not hermes.pre_tool_call("delegate_task", {}).modified


def test_other_tools_are_untouched_and_cost_no_service_call(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    for name in ("terminal", "read_file", "web_search"):
        decision = hermes.pre_tool_call(name, {"command": "ls"})
        assert not decision.blocked and not decision.modified
    assert wb.calls == []


def test_without_a_consult_the_child_is_still_told_to_consult_and_the_parent_receipt_is_absent(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    wb.reachable = False
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)  # consult failed
    decision = hermes.pre_tool_call("delegate_task", SPAWN)
    context = decision.args["tasks"][0]["context"]
    assert decision.modified and "Parent knowledge receipt" not in context and "knowledge_consult" in context


def test_require_receipt_for_delegation_blocks_without_a_consult(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world(settings={"require_receipt_for_delegation": True})
    wb.reachable = False
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", SPAWN)
    assert (
        decision.blocked
        and "no Knowledge Receipt" in (decision.message or "")
        and "unreachable" in (decision.message or "")
    )
    wb.reachable = True
    hermes.pre_llm_call(user_message="retry", is_first_turn=False)
    assert not hermes.pre_tool_call("delegate_task", SPAWN).blocked


def test_a_confirmation_required_receipt_counts_as_a_consult(make_world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = make_world(target="cloud_model", settings={"require_receipt_for_delegation": True})
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    assert not hermes.pre_tool_call("delegate_task", SPAWN).blocked


# --- kanban_complete -------------------------------------------------------------------------------


def test_kanban_complete_without_receipts_is_blocked_with_instructions(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    for args in (
        {"summary": "done"},
        {"summary": "done", "metadata": {}},
        {"summary": "d", "metadata": {"knowledgeReceipt": "x"}},
    ):
        decision = hermes.pre_tool_call("kanban_complete", args)
        assert decision.blocked
        assert "knowledgeReceipt" in decision.message and "writeBackReceipt" in decision.message  # type: ignore[operator]
        assert "knowledge_write_back" in decision.message and "instead of inventing" in decision.message  # type: ignore[operator]


def test_kanban_complete_with_valid_fields_passes(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    hermes.ctx.call_mcp(
        "worldbuilder",
        "knowledge_write_back",
        {"taskRef": "hermes:session-1", "notNeeded": {"reason": "no_new_knowledge"}},
    )
    decision = hermes.pre_tool_call("kanban_complete", {"summary": "done", "metadata": _handoff(wb)})
    assert not decision.blocked and not decision.modified


def test_kanban_metadata_is_checked_for_shape_not_only_presence(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    hermes.ctx.call_mcp(
        "worldbuilder",
        "knowledge_write_back",
        {"taskRef": "hermes:session-1", "notNeeded": {"reason": "no_new_knowledge"}},
    )
    good = _handoff(wb)
    for broken in (
        {**good, "knowledgeReceipt": {"receiptId": good["knowledgeReceipt"]["receiptId"]}},
        {**good, "writeBackReceipt": "01M1KM00000000000000000002"},
        {**good, "cardWritten": {"cardId": "not-a-ulid"}},
        {**good, "cardWritten": {"notNeededBecause": "because"}},
        {**good, "cardWritten": {"proposalId": good["writeBackReceipt"]["receiptId"], "cardId": "x"}},
    ):
        assert hermes.pre_tool_call("kanban_complete", {"summary": "d", "metadata": broken}).blocked


def test_the_kanban_gate_can_be_switched_off(make_world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = make_world(settings={"gate_kanban_complete": False})
    assert not hermes.pre_tool_call("kanban_complete", {"summary": "done"}).blocked


def test_an_internal_error_fails_closed_with_a_readable_message(world, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys

    _, hermes = world
    module = sys.modules["hermes_plugins.worldbuilder_knowledge_loop.handoff"]
    monkeypatch.setattr(module, "merge_output_schema", lambda *_: (_ for _ in ()).throw(RuntimeError("boom")))
    decision = hermes.pre_tool_call("delegate_task", SPAWN)
    assert decision.blocked and "hand-off check failed (RuntimeError)" in (decision.message or "")


def test_the_handoff_the_plugin_demands_is_what_the_verifier_reads(world) -> None:  # type: ignore[no-untyped-def]
    """A valid hand-off becomes a valid task record with three more keys (task-record.schema.json)."""
    wb, hermes = world
    hermes.pre_llm_call(user_message=f"Task ref: TASK-2026-0042\n{TASK}", is_first_turn=True)
    hermes.ctx.call_mcp(
        "worldbuilder",
        "knowledge_write_back",
        {"taskRef": "TASK-2026-0042", "notNeeded": {"reason": "no_new_knowledge"}},
    )
    fields = _handoff(wb)
    record = {
        "taskRef": "TASK-2026-0042",
        "agent": wb.agent,
        "completedAt": "2026-10-05T09:30:00Z",
        "knowledgeReceipt": fields["knowledgeReceipt"],
        "writeBackReceipt": fields["writeBackReceipt"],
    }
    assert_valid("task-record.schema.json", record)
    assert WORLD_ID  # the harness world


# --- action, tasks and shapes as Hermes reads them (tools/delegate_tool.py) ---------------------------


@pytest.mark.parametrize("action", [None, "", "  ", "spawn", " Spawn ", "SPAWN"])
def test_spawn_is_recognised_like_hermes_does(world, action) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", {**SPAWN, "action": action})
    assert decision.modified and not decision.blocked
    assert "knowledgeReceipt" in decision.args["tasks"][0]["output_schema"]["properties"]


@pytest.mark.parametrize("action", ["List", " STOP ", "Steer"])
def test_control_actions_are_recognised_after_normalising(world, action) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    decision = hermes.pre_tool_call("delegate_task", {"action": action, "subagent_id": "sa-1"})
    assert not decision.blocked and not decision.modified


def test_tasks_passed_as_a_json_string_are_decoded_and_rewritten(world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", {"tasks": json.dumps(SPAWN["tasks"])})
    assert decision.modified and not decision.blocked
    tasks = decision.args["tasks"]
    assert isinstance(tasks, list) and tasks[0]["goal"].endswith(SPAWN["tasks"][0]["goal"])
    assert "knowledgeReceipt" in tasks[0]["output_schema"]["properties"]


@pytest.mark.parametrize(
    "args",
    [
        {"tasks": "not json at all"},
        {"tasks": '{"goal": "an object, not a list"}'},
        {"tasks": [{"goal": "ok"}, "a string task"]},
        {"tasks": [{"context": "no goal"}]},
        {"tasks": 7},
        {},
        {"goal": "   "},
    ],
)
def test_a_spawn_of_unknown_shape_is_blocked_not_passed_through(world, args) -> None:  # type: ignore[no-untyped-def]
    _, hermes = world
    hermes.pre_llm_call(user_message=TASK, is_first_turn=True)
    decision = hermes.pre_tool_call("delegate_task", args)
    assert decision.blocked and "delegate_task blocked" in (decision.message or "")


def test_a_child_turn_whose_user_message_is_only_the_goal_consults_for_its_own_task(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_llm_call(user_message=f"Task ref: TASK-2026-0042\n{TASK}", is_first_turn=True)
    # the model copied the parent's reference into the goal; the plugin's child reference still leads
    spawn = {"tasks": [{"goal": "Task ref: TASK-2026-0042\nFind the insurers' view", "context": "c"}]}
    goal = hermes.pre_tool_call("delegate_task", spawn).args["tasks"][0]["goal"]
    assert goal.startswith("Task ref: TASK-2026-0042.s1\n")
    hermes.pre_llm_call(session_id="child-1", user_message=goal, is_first_turn=True)
    assert wb.calls[-1][0] == "knowledge_consult" and wb.calls[-1][1]["taskRef"] == "TASK-2026-0042.s1"
    assert wb.receipts[-1]["taskRef"] == "TASK-2026-0042.s1"


def test_the_handoff_block_beats_a_copied_parent_ref(world) -> None:  # type: ignore[no-untyped-def]
    import sys

    _, hermes = world
    sessions = sys.modules[next(m for m in sys.modules if m.endswith(".session"))]
    text = "Task ref: PARENT-1\nWORLDBUILDER HAND-OFF (mandatory)\nTask ref: PARENT-1.s2\nmore"
    assert sessions.explicit_task_ref(text) == "PARENT-1.s2"
    assert sessions.explicit_task_ref("Task ref: A-1\nTask ref: B-2") == "A-1"
