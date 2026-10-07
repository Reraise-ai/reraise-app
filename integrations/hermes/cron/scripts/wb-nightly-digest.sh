#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Nightly: regenerate the atlas pages from the cards (`wb digest`, ADR-0043).
# Hermes no-agent job semantics: empty stdout = silent success; any output is delivered; a
# non-zero exit delivers an error alert.
. "$(dirname "$0")/wb-env.sh"
wb_need WB_STORE "$WB_STORE"

set -- digest --store "$WB_STORE"
[ -n "$WB_ATLAS_DIR" ] && set -- "$@" --out "$WB_ATLAS_DIR"
[ -n "$WB_GATE_RULES" ] && set -- "$@" --gate-rules "$WB_GATE_RULES"

if out=$(wb_cmd "$@" 2>&1); then
  exit 0
else
  code=$?
fi
printf 'Worldbuilder atlas digest FAILED (wb exit %s):\n%s\n' "$code" "$out"
exit "$code"
