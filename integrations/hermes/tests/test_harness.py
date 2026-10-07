# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""The harness checks itself: its hashing matches the repository's, it loads the plugin the way
Hermes does, and the fake host enforces the Hermes rules the plugin relies on."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from conftest import PLUGIN_DIR
from harness.fake_hermes import FakeCtx, FakeHermes
from harness.fake_worldbuilder import WORLD_ID, FakeWorldbuilder
from harness.jcs import hash_jcs, with_hash
from harness.schema_check import SCHEMAS_DIR, assert_valid, errors, fixture


def test_jcs_hash_matches_the_repository_fixtures() -> None:
    receipt = fixture("knowledge-receipt-cards")
    assert with_hash(receipt)["hash"] == receipt["hash"]  # hashJcs of packages/core
    entry = fixture("receipt-log-entry-first")
    assert with_hash(entry)["hash"] == entry["hash"]
    assert hash_jcs({"b": 1, "a": [True, None, "é"]}) == hash_jcs({"a": [True, None, "é"], "b": 1})


def test_schema_registry_resolves_cross_file_refs_and_rejects_bad_values() -> None:
    assert_valid("knowledge-receipt.schema.json#/$defs/consultResult", fixture("knowledge-consult-result"))
    assert errors("write-back-receipt.schema.json#/$defs/request", {"taskRef": "has space"})


def test_plugin_registers_what_its_manifest_declares(world: tuple[FakeWorldbuilder, FakeHermes]) -> None:
    _, hermes = world
    manifest = yaml.safe_load((PLUGIN_DIR / "plugin.yaml").read_text(encoding="utf-8"))
    assert manifest["name"] == PLUGIN_DIR.name == hermes.ctx.plugin_id
    assert set(hermes.ctx.hooks) == set(manifest["provides_hooks"]) == {"pre_llm_call", "pre_tool_call"}
    assert not hermes.unknown_hooks
    assert manifest["provides_tools"] == [] and not hermes.ctx.tools
    assert manifest["license"] == "Apache-2.0"
    assert "worldbuilder-knowledge-loop:reviewer" in hermes.ctx.skills


def test_system_prompt_section_is_short_and_names_the_mandatory_steps(world: tuple[FakeWorldbuilder, FakeHermes]) -> None:
    _, hermes = world
    section = hermes.ctx.sections["worldbuilder-knowledge-loop"]
    assert section["position"] == "after_memory"
    assert len(section["content"]) < 2000
    for needle in ("knowledge_write_back", "knowledgeReceipt", "writeBackReceipt", "cardWritten", "wb receipts verify"):
        assert needle in section["content"]


def test_call_mcp_is_default_deny_like_hermes(make_world) -> None:  # type: ignore[no-untyped-def]
    _, hermes = make_world(mcp_allowlist=[])
    with pytest.raises(PermissionError, match="mcp_allowlist"):
        hermes.ctx.call_mcp("worldbuilder", "memory_route", {"text": "x"})


def test_fake_hermes_rejects_what_the_real_one_rejects(tmp_path: Path) -> None:
    ctx = FakeCtx(plugin_id="p", host=FakeHermes(PLUGIN_DIR, settings={}, transport=FakeWorldbuilder(tmp_path)))
    with pytest.raises(ValueError):
        ctx.register_system_prompt_section("Bad Id", "x")
    with pytest.raises(ValueError):
        ctx.register_system_prompt_section("ok", "x" * 4001)
    with pytest.raises(ValueError):
        ctx.register_system_prompt_section("ok2", "x", position="before_memory")


def test_fake_worldbuilder_validates_requests_against_the_schemas(world: tuple[FakeWorldbuilder, FakeHermes]) -> None:
    wb, hermes = world
    envelope = hermes.ctx.call_mcp("worldbuilder", "knowledge_consult", {"taskRef": "a b", "task": "x", "worldId": WORLD_ID})
    assert envelope["ok"] is False and "invalid arguments" in envelope["error"]
    envelope = hermes.ctx.call_mcp("worldbuilder", "decision_record", {})
    assert envelope["ok"] is False and "not implemented" in envelope["error"]


def test_receipt_log_written_by_the_fake_is_a_valid_chain(world: tuple[FakeWorldbuilder, FakeHermes]) -> None:
    wb, hermes = world
    for ref in ("T-1", "T-2"):
        hermes.ctx.call_mcp("worldbuilder", "knowledge_consult", {"taskRef": ref, "task": "tankers reroute", "worldId": WORLD_ID})
    lines = [json.loads(line) for line in Path(wb.log_path).read_text(encoding="utf-8").splitlines()]
    assert [e["seq"] for e in lines] == [0, 1]
    assert lines[1]["prev"] == lines[0]["hash"]
    for entry in lines:
        assert with_hash(entry)["hash"] == entry["hash"]
        assert with_hash(entry["receipt"])["hash"] == entry["receipt"]["hash"]


def test_every_schema_the_harness_uses_exists() -> None:
    for name in ("knowledge-receipt", "write-back-receipt", "memory-route", "receipt-log-entry", "task-record"):
        assert (SCHEMAS_DIR / f"{name}.schema.json").is_file()
