# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""A thin client over ``ctx.call_mcp`` (hermes-agent hermes_cli/plugins.py, PluginContext.call_mcp).

``call_mcp`` is synchronous, default-deny (``plugins.entries.<id>.mcp_allowlist``) and returns an
envelope ``{"ok": bool, "result"|"error": ..., "structuredContent"?: ..., "truncated"?: True}``.
This client turns every failure into one exception type with a machine-readable kind, so the hooks
never swallow an error silently.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from .settings import Settings

_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def bounded(text: Any, limit: int = 300) -> str:
    """One line of printable text, at most ``limit`` characters (error texts reach the model)."""
    flat = _CONTROL.sub(" ", str(text)).replace("\n", " ").strip()
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


class WorldbuilderError(Exception):
    """kind: not_allowed | unreachable | tool_error | malformed | not_configured | deadline."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = bounded(message)


class Deadline:
    """A budget for one hook invocation: Hermes abandons a timed-out ``pre_tool_call`` callback and
    fails closed, so the calls inside it must fit into ``plugins.hook_callback_timeout``."""

    def __init__(self, seconds: float) -> None:
        self._end = time.monotonic() + seconds

    def remaining(self) -> float:
        return self._end - time.monotonic()


class WorldbuilderClient:
    def __init__(self, ctx: Any, settings: Settings) -> None:
        self._ctx = ctx
        self._settings = settings

    def call(self, tool: str, arguments: dict[str, Any], deadline: Deadline | None = None) -> dict[str, Any]:
        problems = self._settings.problems()
        if problems:
            raise WorldbuilderError("not_configured", "; ".join(problems))
        timeout = self._settings.call_timeout
        if deadline is not None:
            left = deadline.remaining()
            if left < 1.0:
                raise WorldbuilderError("deadline", "no time left in this hook for another call")
            timeout = min(timeout, left)
        try:
            envelope = self._ctx.call_mcp(self._settings.server, tool, arguments, timeout)
        except PermissionError as exc:
            raise WorldbuilderError("not_allowed", str(exc)) from exc
        except Exception as exc:  # the transport, the breaker and the SDK raise many types
            raise WorldbuilderError("unreachable", f"{type(exc).__name__}: {exc}") from exc
        return self._payload(tool, envelope)

    @staticmethod
    def _payload(tool: str, envelope: Any) -> dict[str, Any]:
        if not isinstance(envelope, dict):
            raise WorldbuilderError("malformed", f"{tool}: unexpected envelope")
        if envelope.get("ok") is not True:
            raise WorldbuilderError("tool_error", f"{tool}: {envelope.get('error', 'unknown error')}")
        if envelope.get("truncated"):
            raise WorldbuilderError("malformed", f"{tool}: result truncated by Hermes (over 64 KB)")
        structured = envelope.get("structuredContent")
        if isinstance(structured, dict):
            return structured
        result = envelope.get("result")
        if isinstance(result, dict):
            return result
        if isinstance(result, str):
            try:
                parsed = json.loads(result)
            except ValueError:
                parsed = None
            if isinstance(parsed, dict):
                return parsed
        raise WorldbuilderError("malformed", f"{tool}: result is not a JSON object")
