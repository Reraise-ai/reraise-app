# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""The card draft of a memory write (shared by the memory gate and the outbox flush)."""

from __future__ import annotations

import re
from typing import Any


def _title(text: str) -> str:
    first = re.split(r"(?<=[.!?])\s|\n", text.strip(), maxsplit=1)[0].strip()
    return (first[:100] or "Agent memory").strip()


def card_draft(text: str, world_id: str) -> dict[str, Any]:
    """A private experience card (schemas/card.schema.json#/$defs/draft). The author comes from the
    connection, release can only be private and training only false (ADR-0036, ADR-0039)."""
    return {
        "format": 2,
        "collection": "evidence",
        "type": "experience",
        "title": _title(text),
        "body": text.strip(),
        "layer": "experience",
        "originSystem": "hermes-memory",
        "worlds": [world_id],
        "release": "private",
        "training": False,
    }
