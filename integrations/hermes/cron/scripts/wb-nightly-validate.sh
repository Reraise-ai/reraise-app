#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Nightly: verify the receipts of the day's task records (`wb receipts verify`, ADR-0040).
# WB_TASKS_DIR holds the task records: the JSON files the plugin writes and the hand-offs agents save
# as Markdown. Only *.md and *.json files (searched recursively) are read; other files are ignored.
# Records modified in the last WB_TASK_LOOKBACK_HOURS (default 24) are copied and verified together
# in one run, so reuse of a receipt across tasks is caught. Silent when all is valid or there was no task; otherwise the failures are the
# message. Exit code: 0 done (silent or failures reported), 1 task records failed,
# 3 the receipt log is broken (tamper evidence), 2 cannot verify.
#
# Also reports the pending write-back outbox (ADR-0046): the count of pending and blocked (secret-like)
# entries whenever there are any, and exit 4 when an entry is older than WB_PENDING_MAX_AGE_HOURS (24)
# and still not flushed. The receipt result keeps its own exit code when both fail.
. "$(dirname "$0")/wb-env.sh"
wb_need WB_TASKS_DIR "$WB_TASKS_DIR"
if [ ! -d "$WB_TASKS_DIR" ]; then
  echo "wb-nightly-validate: WB_TASKS_DIR is not a directory" >&2
  exit 2
fi

wb_pending_check
[ -n "$wb_pending_out" ] && printf '%s\n' "$wb_pending_out"

# Everything temporary lives in one directory, so the trap removes all of it: the file list stays
# outside the folder that is verified.
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/records" || exit 2
minutes=$((WB_TASK_LOOKBACK_HOURS * 60))
find "$WB_TASKS_DIR" -type f \( -name '*.md' -o -name '*.json' \) -mmin "-$minutes" >"$tmp/list" 2>/dev/null
n=0
while IFS= read -r f; do
  n=$((n + 1))
  cp "$f" "$tmp/records/$n-$(basename "$f")"
done <"$tmp/list"
[ "$n" -eq 0 ] && exit "$wb_pending_code"

if out=$(wb_cmd receipts verify "$tmp/records" 2>&1); then
  exit "$wb_pending_code"
else
  code=$?
fi
case "$code" in
  1) printf 'Worldbuilder receipts: %s task record(s) of the last %s h, at least one has NO VALID RECEIPTS:\n%s\n' "$n" "$WB_TASK_LOOKBACK_HOURS" "$out" ;;
  3) printf 'Worldbuilder receipt log is BROKEN (tamper evidence); every task fails:\n%s\n' "$out" ;;
  *) printf 'Worldbuilder receipts could not be verified (wb exit %s):\n%s\n' "$code" "$out" ;;
esac
exit "$code"
