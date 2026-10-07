#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Install the Worldbuilder knowledge-loop cron jobs into Hermes.
#
#   install-cron.sh [--dry-run] [--deliver <target>] [--hermes-home <dir>]
#
# 1. copies the scripts to $HERMES_HOME/scripts/ (Hermes only runs scripts that live there) and
#    creates worldbuilder-loop.conf from the example if it does not exist (never overwritten);
# 2. creates four no-agent jobs with `hermes cron create` (syntax: hermes_cli/subcommands/cron.py):
#      worldbuilder-nightly-digest    17 2 * * *    wb digest
#      worldbuilder-nightly-validate  37 3 * * *    wb receipts verify over the day's task records
#      worldbuilder-weekly-metrics    23 7 * * MON  wb metrics
#      worldbuilder-watchdog          41 6 * * *    atlas lag > 3 days, or a week without accepted cards
#    A job that already exists (by name) is left alone, so the script can be run again.
# --deliver is where output goes (default: local = files under $HERMES_HOME/cron/output; use a chat
# platform such as telegram to get alerts). --dry-run prints every step and changes nothing.
set -u

dry=0
deliver=local
home="${HERMES_HOME:-$HOME/.hermes}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --deliver) shift; deliver="${1:?--deliver needs a target}" ;;
    --hermes-home) shift; home="${1:?--hermes-home needs a directory}" ;;
    -h | --help) sed -n '5,19p' "$0"; exit 0 ;;
    *) echo "install-cron.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

here=$(cd "$(dirname "$0")" && pwd)
dest="$home/scripts"

# quote <arg>: the argument as a shell would need it (for the dry-run printout).
quote() {
  case "$1" in
    *[!A-Za-z0-9_./=:@%+-]* | '') printf "'%s'" "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

failed=0
# step <command...>: run it (or print it with --dry-run); a failure is counted and reported at the end.
step() {
  if [ "$dry" -eq 1 ]; then
    printf '[dry-run]'
    for arg in "$@"; do printf ' %s' "$(quote "$arg")"; done
    printf '\n'
  elif ! "$@"; then
    echo "install-cron.sh: FAILED: $*" >&2
    failed=$((failed + 1))
    return 1
  fi
}

step mkdir -p "$dest"
for f in "$here"/scripts/*.sh "$here"/scripts/*.ps1; do
  step cp "$f" "$dest/"
done
step chmod +x "$dest"/wb-*.sh
if [ -f "$dest/worldbuilder-loop.conf" ]; then
  echo "kept existing $dest/worldbuilder-loop.conf"
else
  step cp "$here/scripts/worldbuilder-loop.conf.example" "$dest/worldbuilder-loop.conf"
  if [ "$dry" -eq 1 ]; then verb="would create"; else verb=created; fi
  echo "$verb $dest/worldbuilder-loop.conf: edit it (store, task record folder) before the first run"
fi

if [ "$dry" -eq 0 ] && ! command -v hermes >/dev/null 2>&1; then
  echo "install-cron.sh: the hermes command is not on PATH" >&2
  exit 2
fi
existing=""
if [ "$dry" -eq 0 ]; then
  if ! existing=$(hermes cron list --all 2>/dev/null); then
    # Without the list a second run would create every job twice: read Hermes' job file instead.
    echo "install-cron.sh: hermes cron list failed; checking $home/cron/jobs.json for existing jobs" >&2
    existing=$(cat "$home/cron/jobs.json" 2>/dev/null || true)
  fi
fi

job() { # job <name> <schedule> <script>
  case "$existing" in
    *"$1"*) echo "job $1 exists; left alone"; return 0 ;;
  esac
  step hermes cron create "$2" --no-agent --script "$3" --name "$1" --deliver "$deliver"
}

job worldbuilder-nightly-digest "17 2 * * *" wb-nightly-digest.sh
job worldbuilder-nightly-validate "37 3 * * *" wb-nightly-validate.sh
job worldbuilder-weekly-metrics "23 7 * * MON" wb-weekly-metrics.sh
job worldbuilder-watchdog "41 6 * * *" wb-watchdog.sh

if [ "$failed" -gt 0 ]; then
  echo "install-cron.sh: $failed step(s) failed; fix the cause and run it again (finished jobs are left alone)" >&2
  exit 1
fi
echo "done. Check with: hermes cron list ; hermes cron doctor"
