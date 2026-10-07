# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import pytest

from harness.fake_hermes import FakeHermes
from harness.fake_worldbuilder import WORLD_ID, FakeWorldbuilder

HERMES_DIR = Path(__file__).resolve().parents[1]
PLUGIN_DIR = HERMES_DIR / "plugins" / "worldbuilder-knowledge-loop"

World = tuple[FakeWorldbuilder, FakeHermes]


@pytest.fixture
def make_world(tmp_path: Path) -> Callable[..., World]:
    """Build a fake Worldbuilder and a fake Hermes with the plugin loaded."""
    counter = {"n": 0}

    def build(
        *,
        target: str = "local_model",
        settings: dict[str, Any] | None = None,
        mcp_allowlist: list[str] | None = None,
        structured_content: bool = True,
        connection_failure: str = "envelope",
    ) -> World:
        counter["n"] += 1
        wb = FakeWorldbuilder(tmp_path / f"state{counter['n']}", target=target)
        merged = {"world_id": WORLD_ID, **(settings or {})}
        hermes = FakeHermes(
            PLUGIN_DIR,
            settings=merged,
            transport=wb,
            mcp_allowlist=mcp_allowlist,
            structured_content=structured_content,
            connection_failure=connection_failure,
        ).load()
        return wb, hermes

    return build


@pytest.fixture
def world(make_world: Callable[..., World]) -> World:
    return make_world()
