#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Watchdog: say something only when the loop has stopped.
#   - the atlas has been out of date for more than WB_MAX_ATLAS_LAG_HOURS (default 72 = 3 days),
#     or there is no atlas at all (lag unknown counts as a failure, ADR-0041);
#   - no agent card was accepted in the last 7 days (the message says how many were proposed, so
#     "agents write nothing" and "nobody reviews" can be told apart).
# Silent when healthy. Exit code: 0 done (alerts, if any, are the output), non-zero when wb or the
# JSON reader fails: a broken watchdog must not look like a healthy loop.
. "$(dirname "$0")/wb-env.sh"
wb_need WB_STORE "$WB_STORE"
if ! command -v node >/dev/null 2>&1; then
  echo "wb-watchdog: node is not on PATH (wb needs it too)" >&2
  exit 2
fi

set -- --json --store "$WB_STORE"
[ -n "$WB_TASKS_DIR" ] && set -- "$@" --tasks "$WB_TASKS_DIR"
[ -n "$WB_ATLAS_DIR" ] && set -- "$@" --atlas "$WB_ATLAS_DIR"
[ -n "$WB_GATE_RULES" ] && set -- "$@" --gate-rules "$WB_GATE_RULES"

err=$(mktemp) || exit 2
trap 'rm -f "$err"' EXIT HUP INT TERM
# stdout only is JSON; wb's warnings (stderr) must not corrupt it.
if json=$(wb_cmd metrics "$@" 2>"$err"); then
  :
else
  code=$?
  printf 'Worldbuilder watchdog: wb metrics FAILED (exit %s):\n%s\n%s\n' "$code" "$json" "$(cat "$err")"
  exit "$code"
fi

js='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let m;try{m=JSON.parse(s)}catch(e){console.error("not JSON: "+e.message);process.exit(2)}
  const max=Number(process.argv[1]),out=[],lag=m.atlas&&m.atlas.lagHours,t=m.totals||{};
  if(lag===null||lag===undefined)out.push("atlas: no pages, or the lag cannot be determined - run wb digest");
  else if(lag>max)out.push("atlas: out of date for "+lag+" h (limit "+max+" h) - run wb digest");
  if(!t.cardsAccepted)out.push("cards: no agent card accepted in the last 7 days ("+(t.cardsProposed||0)+" proposed)");
  process.stdout.write(out.join("\n"));
})'
if ! alerts=$(printf '%s' "$json" | node -e "$js" "$WB_MAX_ATLAS_LAG_HOURS" 2>&1); then
  printf 'Worldbuilder watchdog: cannot read the metrics: %s\n' "$alerts"
  exit 2
fi
[ -z "$alerts" ] && exit 0
printf 'Worldbuilder knowledge loop needs attention:\n%s\n' "$alerts"
exit 0
