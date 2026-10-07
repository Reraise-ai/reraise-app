#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Shared settings of the Worldbuilder knowledge-loop cron scripts; sourced by the others.
#
# Hermes runs cron scripts with a sanitized environment (hermes-agent cron docs, "No-agent mode"),
# so the settings come from a file, not from the environment:
#   $HERMES_HOME/scripts/worldbuilder-loop.conf   (KEY=VALUE lines; see the .example next to it)
# The file is parsed, never executed. Unknown keys are an error, so a typo cannot pass silently.

wb_conf="${WB_LOOP_CONF:-${HERMES_HOME:-$HOME/.hermes}/scripts/worldbuilder-loop.conf}"

WB_BIN="${WB_BIN:-wb}"
WB_STATE_DIR="${WB_STATE_DIR:-}"
WB_STORE="${WB_STORE:-}"
WB_TASKS_DIR="${WB_TASKS_DIR:-}"
WB_ATLAS_DIR="${WB_ATLAS_DIR:-}"
WB_GATE_RULES="${WB_GATE_RULES:-}"
WB_TASK_LOOKBACK_HOURS="${WB_TASK_LOOKBACK_HOURS:-24}"
WB_MAX_ATLAS_LAG_HOURS="${WB_MAX_ATLAS_LAG_HOURS:-72}"

if [ -f "$wb_conf" ]; then
  cr=$(printf '\r')
  while IFS='=' read -r wb_key wb_value || [ -n "$wb_key" ]; do
    wb_key=${wb_key%"$cr"}
    case "$wb_key" in
      '' | '#'*) continue ;;
    esac
    wb_value=${wb_value%"$cr"}
    case "$wb_key" in
      WB_BIN | WB_STATE_DIR | WB_STORE | WB_TASKS_DIR | WB_ATLAS_DIR | WB_GATE_RULES | WB_TASK_LOOKBACK_HOURS | WB_MAX_ATLAS_LAG_HOURS)
        eval "$wb_key=\$wb_value"
        ;;
      *)
        echo "worldbuilder-loop.conf: unknown key '$wb_key'" >&2
        exit 2
        ;;
    esac
  done <"$wb_conf"
fi

# The plugin writes its task records to <HERMES_HOME>/worldbuilder/task-records (setting
# task_records_dir): use that folder when WB_TASKS_DIR is not set and the folder exists.
if [ -z "$WB_TASKS_DIR" ] && [ -d "${HERMES_HOME:-$HOME/.hermes}/worldbuilder/task-records" ]; then
  WB_TASKS_DIR="${HERMES_HOME:-$HOME/.hermes}/worldbuilder/task-records"
fi

# wb_cmd <args...>: run the wb command line; --state goes last, after the subcommand and its
# arguments (WB_BIN may be a command with arguments, such as
# "node /path/to/dist/bin.js"; a path with spaces is not supported).
wb_cmd() {
  if [ -n "$WB_STATE_DIR" ]; then
    # shellcheck disable=SC2086
    $WB_BIN "$@" --state "$WB_STATE_DIR"
  else
    # shellcheck disable=SC2086
    $WB_BIN "$@"
  fi
}

# wb_need <name> <value>: stop with exit code 2 and a clear message when a setting is missing.
wb_need() {
  if [ -z "$2" ]; then
    echo "$(basename "$0"): $1 is not set (set it in $wb_conf)" >&2
    exit 2
  fi
}
