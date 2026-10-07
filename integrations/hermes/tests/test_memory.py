# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""``pre_tool_call`` on ``memory``: durable lessons become card proposals, operational facts stay
in memory. Argument shapes: hermes-agent tools/memory_tool.py, MEMORY_SCHEMA."""

from __future__ import annotations

from harness.fake_worldbuilder import WORLD_ID
from harness.schema_check import assert_valid

LESSON = "Lesson learned: war-risk premiums tend to double within a day of the first transit announcement."
OPS = "Restarted the gateway today because of a timeout; retry worked."
SECRET = "The staging api key is sk_test_4eC39HqLyjWDarjtT1zdp7dc and the token is abc123"


def memory(**kw):  # type: ignore[no-untyped-def]
    return {"target": "memory", **kw}


def test_an_operational_fact_is_written_to_memory_unchanged(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    args = memory(action="add", content=OPS)
    decision = hermes.pre_tool_call("memory", args)
    assert not decision.blocked and not decision.modified and decision.args == args
    assert wb.tools_called() == ["memory_route"]  # classified, nothing created
    assert wb.proposals == [] and wb.receipts == []


def test_a_durable_lesson_becomes_a_card_proposal_and_the_memory_write_is_blocked(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_llm_call(user_message="Task ref: TASK-2026-0042\ntankers", is_first_turn=True)
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert decision.blocked
    assert wb.tools_called() == ["knowledge_consult", "memory_route", "knowledge_write_back"]
    proposal = wb.proposals[0]
    receipt = wb.receipts[-1]
    assert proposal["status"] == "pending" and proposal["author"] == wb.agent
    assert proposal["id"] in (decision.message or "") and receipt["receiptId"] in (decision.message or "")
    assert "not saved to memory" in (decision.message or "") and "Do not repeat" in (decision.message or "")
    # the write-back belongs to the running task and links the consult
    _, arguments = wb.calls[-1]
    assert arguments["taskRef"] == "TASK-2026-0042" and arguments["consultReceiptId"] == wb.receipts[0]["receiptId"]
    assert receipt["taskRef"] == "TASK-2026-0042" and receipt["consultReceiptId"] == wb.receipts[0]["receiptId"]


def test_the_card_draft_is_private_untrained_and_valid(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON + "\nSecond line."))
    card = wb.calls[-1][1]["card"]
    assert card["release"] == "private" and card["training"] is False
    assert card["layer"] == "experience" and card["worlds"] == [WORLD_ID]
    assert (
        card["title"]
        == "Lesson learned: war-risk premiums tend to double within a day of the first transit announcement."
    )
    assert "author" not in card and "id" not in card  # set by the service from the connection
    assert_valid("write-back-receipt.schema.json#/$defs/request", wb.calls[-1][1])


def test_without_a_task_the_memory_job_still_gets_a_valid_task_ref(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_tool_call("memory", memory(action="add", content=LESSON), session_id="nightly memory job #3")
    assert wb.calls[-1][1]["taskRef"] == "memory:nightly-memory-job-#3"
    assert "consultReceiptId" not in wb.calls[-1][1]


def test_secrets_never_become_cards_and_the_memory_write_is_not_this_plugin_s_to_stop(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    decision = hermes.pre_tool_call("memory", memory(action="add", content=SECRET + " " + LESSON))
    assert not decision.blocked and wb.proposals == []
    assert "knowledge_write_back" not in wb.tools_called()


def test_the_user_profile_target_is_never_sent_to_the_worldbuilder(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    args = {"target": "user", "action": "add", "content": LESSON}
    decision = hermes.pre_tool_call("memory", args)
    assert not decision.blocked and not decision.modified and wb.calls == []


def test_remove_and_empty_operations_are_not_routed(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    assert not hermes.pre_tool_call("memory", memory(action="remove", old_text="x")).modified
    assert not hermes.pre_tool_call("memory", memory(action="add", content="   ")).modified
    assert wb.calls == []


def test_replace_with_the_new_text_alias_is_routed(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    decision = hermes.pre_tool_call("memory", memory(action="replace", old_text="old", new_text=LESSON))
    assert decision.blocked and len(wb.proposals) == 1


def test_a_batch_keeps_the_operational_items_and_drops_the_lessons(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    ops = [
        {"action": "add", "content": OPS},
        {"action": "add", "content": LESSON},
        {"action": "remove", "old_text": "stale entry"},
    ]
    decision = hermes.pre_tool_call("memory", memory(operations=ops))
    assert not decision.blocked and decision.modified
    assert decision.args["operations"] == [ops[0], ops[2]]
    assert decision.args["target"] == "memory"
    assert len(wb.proposals) == 1


def test_a_batch_of_only_lessons_is_blocked_and_names_every_proposal(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    other = "Insight: carriers always reroute before insurers reprice, because rerouting is cheaper."
    decision = hermes.pre_tool_call(
        "memory", memory(operations=[{"action": "add", "content": LESSON}, {"action": "add", "content": other}])
    )
    assert decision.blocked and len(wb.proposals) == 2
    assert all(p["id"] in (decision.message or "") for p in wb.proposals)


def test_over_long_items_are_not_sent_and_stay_in_memory(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    decision = hermes.pre_tool_call("memory", memory(action="add", content="lesson " * 700))
    assert not decision.blocked and wb.calls == []


def test_route_memory_can_be_switched_off(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world(settings={"route_memory": False})
    assert not hermes.pre_tool_call("memory", memory(action="add", content=LESSON)).blocked
    assert wb.calls == []


# --- when the Worldbuilder cannot be reached ------------------------------------------------------


def test_unreachable_service_allows_the_memory_write_by_default(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    wb.reachable = False
    args = memory(action="add", content=LESSON)
    decision = hermes.pre_tool_call("memory", args)
    assert not decision.blocked and decision.args == args  # nothing is lost


def test_unreachable_service_can_block_the_memory_write(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world(settings={"memory_on_error": "block"})
    wb.reachable = False
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert decision.blocked and "memory write blocked" in (decision.message or "")


def test_a_failed_write_back_after_a_card_route_follows_the_same_policy(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    original = wb._tool_knowledge_write_back

    def fail(arguments):  # type: ignore[no-untyped-def]
        from harness.fake_hermes import McpToolError

        raise McpToolError("proposal queue full")

    wb._tool_knowledge_write_back = fail  # type: ignore[method-assign]
    assert not hermes.pre_tool_call("memory", memory(action="add", content=LESSON)).blocked  # allow
    wb._tool_knowledge_write_back = original  # type: ignore[method-assign]
    assert hermes.pre_tool_call("memory", memory(action="add", content=LESSON)).blocked  # routed now


def test_the_allowlist_is_enforced_for_memory_too(make_world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world(mcp_allowlist=[], settings={"memory_on_error": "block"})
    decision = hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert decision.blocked and "mcp_allowlist" in (decision.message or "")


def test_an_explicit_null_target_means_memory(world) -> None:  # type: ignore[no-untyped-def]
    # Hermes: ``target = "memory" if target is None else target`` (tools/memory_tool.py)
    wb, hermes = world
    assert hermes.pre_tool_call("memory", {"target": None, "action": "add", "content": LESSON}).blocked
    assert len(wb.proposals) == 1
    assert hermes.pre_tool_call("memory", {"target": "", "action": "add", "content": LESSON}).blocked


def test_the_batch_notice_reaches_the_model_on_its_next_turn(world) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    hermes.pre_llm_call(user_message="Task ref: TASK-9\nTankers", is_first_turn=True)
    ops = [{"action": "add", "content": OPS}, {"action": "add", "content": LESSON}]
    decision = hermes.pre_tool_call("memory", memory(operations=ops))
    assert decision.modified and decision.args["operations"] == [ops[0]]
    notice = hermes.pre_llm_call(user_message="next", is_first_turn=False) or ""
    assert wb.proposals[0]["id"] in notice and "not saved to memory" in notice
    assert not hermes.pre_llm_call(user_message="and next", is_first_turn=False)  # told once


def test_a_routing_failure_is_logged_without_the_memory_text(make_world, caplog) -> None:  # type: ignore[no-untyped-def]
    import logging

    wb, hermes = make_world()
    wb.reachable = False
    with caplog.at_level(logging.WARNING):
        hermes.pre_tool_call("memory", memory(action="add", content=LESSON))
    assert "memory routing failed" in caplog.text and "war-risk" not in caplog.text


def test_the_hook_budget_follows_hermes_hook_callback_timeout(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys
    import types

    from harness.fake_hermes import HOOK_CALLBACK_TIMEOUT_SECONDS

    settings = sys.modules[next(m for m in sys.modules if m.endswith(".settings") and "hermes_plugins" in m)]
    assert settings.hook_budget() == HOOK_CALLBACK_TIMEOUT_SECONDS - settings.HOOK_MARGIN  # not in Hermes: default
    fake = types.ModuleType("hermes_cli.config")
    fake.load_config_readonly = lambda: {"plugins": {"hook_callback_timeout": 12}}  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "hermes_cli", types.ModuleType("hermes_cli"))
    monkeypatch.setitem(sys.modules, "hermes_cli.config", fake)
    assert settings.hook_budget() == 12 - settings.HOOK_MARGIN
    fake.load_config_readonly = lambda: {"plugins": {"hook_callback_timeout": 3}}  # type: ignore[attr-defined]
    assert settings.hook_budget() == 2.0  # never below two seconds
