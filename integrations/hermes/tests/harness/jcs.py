# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""RFC 8785 (JCS) serialisation for the JSON values of receipts (strings, integers, booleans,
null, arrays, objects; no floats occur in receipts) and the hashes built on it.

Verified against the repository's fixtures: ``tests/test_harness.py`` recomputes the hash of
schemas/fixtures/valid/knowledge-receipt-cards.json with this module and compares it with
``hashJcs`` from packages/core (content-hash.ts) as stored in the fixture.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _utf16_key(key: str) -> bytes:
    return key.encode("utf-16-be")


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise TypeError("floats are not used in receipts")
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda kv: _utf16_key(kv[0]))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical_json(v) for k, v in items) + "}"
    raise TypeError(f"not JSON: {type(value).__name__}")


def hash_jcs(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def with_hash(obj: dict[str, Any]) -> dict[str, Any]:
    """``obj`` plus its ``hash`` member (hash of the object without it)."""
    body = {k: v for k, v in obj.items() if k != "hash"}
    return {**body, "hash": hash_jcs(body)}
