# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""Validate values against the repository's JSON Schemas (schemas/*.schema.json).

All schemas are registered by their ``$id`` so that relative ``$ref``s between them resolve, and a
reference such as ``knowledge-receipt.schema.json#/$defs/consultRequest`` selects one definition.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMAS_DIR = REPO_ROOT / "schemas"
SCHEMA_BASE = "https://worldbuilder.invalid/schemas/v0/"


@lru_cache(maxsize=1)
def _registry() -> Registry:
    registry: Registry = Registry()
    for path in sorted(SCHEMAS_DIR.glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema, DRAFT202012))
    return registry


def validator(ref: str) -> Draft202012Validator:
    """``ref`` is ``<file>.schema.json`` or ``<file>.schema.json#/$defs/<name>``."""
    return Draft202012Validator({"$ref": SCHEMA_BASE + ref}, registry=_registry())


def errors(ref: str, value: Any) -> list[str]:
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in validator(ref).iter_errors(value)
    ]


def assert_valid(ref: str, value: Any) -> None:
    found = errors(ref, value)
    assert not found, f"{ref} rejects the value:\n" + "\n".join(found[:10])


def fixture(name: str) -> dict[str, Any]:
    """The ``data`` member of a valid schema fixture (schemas/fixtures/valid/<name>.json)."""
    return json.loads((SCHEMAS_DIR / "fixtures" / "valid" / f"{name}.json").read_text(encoding="utf-8"))["data"]
