#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Weekly: the knowledge-loop metrics of the last 7 days (`wb metrics`, ADR-0041) as a report.
# Always prints the report (targets not met are in it); exit code non-zero only when wb itself fails.
. "$(dirname "$0")/wb-env.sh"

set --
[ -n "$WB_TASKS_DIR" ] && set -- "$@" --tasks "$WB_TASKS_DIR"
[ -n "$WB_STORE" ] && set -- "$@" --store "$WB_STORE"
[ -n "$WB_ATLAS_DIR" ] && set -- "$@" --atlas "$WB_ATLAS_DIR"
[ -n "$WB_GATE_RULES" ] && set -- "$@" --gate-rules "$WB_GATE_RULES"

out=$(wb_cmd metrics --check "$@" 2>&1)
code=$?
case "$code" in
  0 | 1) printf '%s\n' "$out"; exit 0 ;;
  *) printf 'Worldbuilder metrics FAILED (wb exit %s):\n%s\n' "$code" "$out"; exit "$code" ;;
esac
