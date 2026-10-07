#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Nightly: verify the receipts of the day's task records (`wb receipts verify`, ADR-0040).
# WB_TASKS_DIR holds the task records (hand-offs) and nothing else; records modified in the last
# WB_TASK_LOOKBACK_HOURS (default 24) are verified together in one run, so reuse of a receipt across
# tasks is caught. Silent when all is valid or there was no task; otherwise the failures are the
# message. Exit code: 0 done (silent or failures reported), 1 task records failed,
# 3 the receipt log is broken (tamper evidence), 2 cannot verify.
. "$(dirname "$0")/wb-env.sh"
wb_need WB_TASKS_DIR "$WB_TASKS_DIR"
if [ ! -d "$WB_TASKS_DIR" ]; then
  echo "wb-nightly-validate: WB_TASKS_DIR is not a directory" >&2
  exit 2
fi

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
minutes=$((WB_TASK_LOOKBACK_HOURS * 60))
find "$WB_TASKS_DIR" -type f \( -name '*.md' -o -name '*.json' \) -mmin "-$minutes" >"$tmp.list" 2>/dev/null
n=0
while IFS= read -r f; do
  n=$((n + 1))
  cp "$f" "$tmp/$n-$(basename "$f")"
done <"$tmp.list"
rm -f "$tmp.list"
[ "$n" -eq 0 ] && exit 0

if out=$(wb_cmd receipts verify "$tmp" 2>&1); then
  exit 0
else
  code=$?
fi
case "$code" in
  1) printf 'Worldbuilder receipts: %s task record(s) of the last %s h, at least one has NO VALID RECEIPTS:\n%s\n' "$n" "$WB_TASK_LOOKBACK_HOURS" "$out" ;;
  3) printf 'Worldbuilder receipt log is BROKEN (tamper evidence); every task fails:\n%s\n' "$out" ;;
  *) printf 'Worldbuilder receipts could not be verified (wb exit %s):\n%s\n' "$code" "$out" ;;
esac
exit "$code"
