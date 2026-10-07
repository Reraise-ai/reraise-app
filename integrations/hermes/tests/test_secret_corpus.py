# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""The secret corpus of ADR-0042 through the memory gate, with the REAL classifier of
packages/knowledge-loop (node subprocess): a secret never becomes a card proposal, so
knowledge_write_back is never called and the memory write is left to Hermes. Every value is built at
run time so that no secret-like literal sits in the repository (ADR-0022)."""

from __future__ import annotations

import pytest
from harness.fake_worldbuilder import REAL_CLASSIFIER, real_route

pytestmark = pytest.mark.skipif(not REAL_CLASSIFIER, reason="needs node and a built packages/knowledge-loop")

TOKEN_LIKE = "ab12" * 8
TAIL = "Zq7Lm2Xv9Kd4Rt6Yb1Nc3Hs5Jw8Fg0Pa"
AWS_LIKE = "/".join(["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"])
JWT_LIKE = ".".join(["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ4In0", "c2lnbmF0dXJl" + "c2lnbmF0dXJl"])

SECRETS = {
    "credential word and colon": f"The importer token: {TOKEN_LIKE}",
    "password assignment": "Lesson learned: always set password = placeholder-value first",
    "private key block": f"-----BEGIN {'PRIVATE'} KEY----- found in the notes, always rotate",
    "hex run in a lesson": f"Cache key {TOKEN_LIKE} because it is stable",
    "one-time pin": "The one-time pin: 4711 for the vault",
    "aws-like secret": f"We always use the AWS secret key {AWS_LIKE} for uploads",
    "openai-style key": f"The model key {'sk' + '-'}{TAIL * 2} always works",
    "live payment key": f"Payments use {'sk' + '_live_'}{TAIL[:24]} always",
    "github token": f"Always push with {'ghp' + '_'}{TAIL}{TAIL[:6]} from CI",
    "json web token": f"The session cookie is {JWT_LIKE}, so always check expiry",
    "url with password": f"Always connect with postgres://admin:{TOKEN_LIKE[:12]}@db.example.org/app",
}

LESSON = "Lesson learned: war-risk premiums tend to double within a day of the first transit announcement."


@pytest.mark.parametrize("name", sorted(SECRETS))
def test_the_real_classifier_calls_every_secret_a_secret(name: str) -> None:
    result = real_route({"text": SECRETS[name]})
    assert (result["route"], result["ruleId"]) == ("ephemeral_ops_fact", "secret"), result


@pytest.mark.parametrize("name", sorted(SECRETS))
@pytest.mark.parametrize("shape", ["single", "batch", "with_lesson"])
def test_no_secret_reaches_a_write_back_through_the_gate(world, name: str, shape: str) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = world
    text = SECRETS[name]
    if shape == "single":
        args = {"target": "memory", "action": "add", "content": text}
    elif shape == "batch":
        args = {
            "target": "memory",
            "operations": [
                {"action": "add", "content": text},
                {"action": "replace", "old_text": "x", "new_text": text},
            ],
        }
    else:
        args = {"target": "memory", "action": "add", "content": f"{LESSON} {text}"}
    decision = hermes.pre_tool_call("memory", args)
    assert "knowledge_write_back" not in wb.tools_called()
    assert wb.proposals == [] and not decision.blocked and decision.args == args
