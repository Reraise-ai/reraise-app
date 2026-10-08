---
status: accepted
date: 2026-10-08
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0046: A memory write made while the Worldbuilder is unreachable is marked pending and offered as a card proposal later

## Context and Problem Statement

[ADR-0044](0044-hermes-integration-package.md) let the Hermes plugin answer an unreachable
Worldbuilder with `memory_on_error: allow`: the agent's memory write simply went ahead (open
question OQ-16). In a measured multi-agent installation the memory job wrote 30 to 40 learnings a
day into a separate memory store instead of the card store. A silent `allow` is the same failure
with an excuse: whatever is written during an outage never reaches the board.

The owner decided (2026-10-08): "If the Worldbuilder is unreachable, the agent may write to its own
memory, but every such entry must be marked 'pending write-back' and offered as a card proposal
automatically once the Worldbuilder is reachable again. Nothing may bypass the loop silently."

## Decision Drivers

- The owner's wording is binding: write allowed, entry marked, proposal offered automatically,
  nothing silent.
- Habits come from mandatory, checked fields ([ADR-0039](0039-knowledge-loop-receipts.md)); an
  outage must not become a loophole.
- Content must not leave the device except through the normal, gated proposal path
  ([ADR-0036](0036-conclusions-are-private.md), [ADR-0042](0042-memory-route-classification.md)):
  secret-like text is never sent.
- The service contracts stay as they are (`schemas/` is unchanged by this decision).
- A flush may be retried after a crash and must not create two proposals for one entry.

## Considered Options

- Keep `allow` (the ADR-0044 default)
- Only `block` while unreachable
- Allow, mark and record in a durable local outbox, flush on reconnect (chosen)

## Decision Outcome

Chosen option: "allow, mark and record, flush on reconnect", because it is the only option that
keeps the agent working during an outage and still brings every entry into the loop.

### The setting

`memory_on_error` takes `queue` (new default) and `block`. The silent `allow` is removed: a
configuration that still says `allow` (or any unknown value) is treated as `queue` and the plugin
logs a deprecation notice. Supersedes the `memory_on_error: allow` default and OQ-16 of
ADR-0044; the rest of ADR-0044 stands.

### Marking

Hermes' `pre_tool_call` can modify tool arguments: a returned `{"action": "modify", "args": {...}}`
is shallow-merged into the arguments of the call (hermes-agent `hermes_cli/plugins.py`,
`_get_pre_tool_call_directive_details`). On an unreachable or failed `memory_route` or
`knowledge_write_back` during a `memory` call, the plugin lets the write through and prefixes the
stored text (`content`, or its alias `new_text`, per item for a batch) with
`[pending write-back <outboxId>]`. The model is told on its next turn.

### The outbox

`$HERMES_HOME/worldbuilder/pending-write-back.jsonl` (setting `pending_file`), mode 0600 in a
0700 folder, one JSON line per entry: `outboxId` (ULID), `agent`, `taskRef`, `createdAt`,
`contentHash` (SHA-256 of the text), `status` and, while the entry is open, `content`. Appends are
one `O_APPEND` write under an exclusive file lock followed by fsync; updates rewrite the file
atomically (temporary file, fsync, replace) under the same lock. The content stays on the device
in this file only. If the entry cannot be made durable, the memory write is blocked: nothing may
bypass the loop silently.

Statuses: `pending`, `submitting`, `done` (tombstone without content, with the proposal id and the
write-back receipt id), `blocked_secret`, `dismissed` (tombstone).

### Flush

Whenever the plugin has just reached the Worldbuilder (a successful `knowledge_consult` in
`pre_llm_call`, a later turn of a consulted task, or a successful `memory_route` in the memory
hook) it offers every open entry, oldest first, at most 25 and within a time budget, with a
back-off of 60 s after a failed flush:

1. `memory_route` classifies the text. A secret-like text (`ruleId: secret` or signal
   `secret_like`) is never sent; the entry becomes `blocked_secret`, is reported in the next
   turn and every night, and stays until the owner reviews it (`outbox.py dismiss <id>` removes
   its content). If the classifier cannot be reached, the flush stops: nothing unclassified is sent.
2. The entry is set to `submitting`, then `knowledge_write_back` creates a private card proposal
   (author is the connection, `release: private`, `training: false`) tagged `pending-write-back`
   and `outbox:<outboxId>`.
3. The entry becomes `done` with the proposal id and the receipt id, and its content is removed.

Every queued entry is offered, including those `memory_route` would call ephemeral operational
facts when the service is reachable. The owner said "every such entry"; during the outage nobody
could classify it, and the human decides on the board. (A later change may send non-secret ephemeral entries as
`notNeeded: ephemeral_ops_fact` write-backs instead; that needs the owner.)

### Idempotency

`knowledge_write_back` has no idempotency key and the request schema forbids extra fields, so the
key travels in the card: the tag `outbox:<outboxId>`. The entry is marked `submitting` before the
call. If an attempt dies with an unknown outcome (the answer is lost after the proposal was
created), the next flush finds the entry still `submitting`, searches `proposal_list` (all
statuses) for that tag and adopts the proposal it finds instead of creating a second. Entries with identical content in
one flush are offered once and share the proposal.

### Nothing silent

- `outbox.py check` (stdlib Python, shipped with the plugin, no Hermes, no `wb`) is run by the
  nightly validation script: it prints the count of pending and blocked entries whenever there are
  any, and the script exits 4 if any open or blocked entry is older than 24 h
  (`WB_PENDING_MAX_AGE_HOURS`); if the receipts also fail, their exit code wins and the report
  is still printed. A checker that cannot run, or an unreadable outbox, exits 2 and is reported.
- The watchdog speaks when an entry has been pending for more than 24 h.
- The session end logs entries of the task that are still pending (ids and counts only).
- Logs, notices and the nightly report never contain memory text.

### Consequences

- Good, because an outage can no longer hide knowledge; every entry ends as a proposal, a visible
  blocked secret, or an alert.
- Good, because the Worldbuilder service, the MCP tools and the schemas are unchanged.
- Bad, because the memory keeps the `[pending write-back ...]` text after the flush (the plugin
  cannot rewrite memory afterwards); the agent may tidy it.
- Bad, because a flush needs the plugin to run inside Hermes: the cron script can report but not
  flush (a stdlib script has no MCP client). An agent that never starts again leaves entries
  pending, which the nightly job reports after 24 h.
- Bad, because if `knowledge_write_back` succeeded but the answer was lost during the live memory
  routing (not the flush), the same lesson can be queued and offered again; the human sees two
  proposals and rejects one.
- Bad, because the task-record schema ([ADR-0040](0040-receipt-log-and-verifier.md)) has no field
  for pending entries, so the task record cannot note them. Known gap: this needs a schema change
  (an optional `pendingWriteBack` list of outbox ids) decided separately; until then the outbox
  entries carry the `taskRef` and the session end logs the count.
- Neutral: items longer than 4000 characters are not routed today and stay in memory unchanged
  (unchanged from ADR-0044).

### Confirmation

`integrations/hermes/tests/test_pending_write_back.py` (queue and marker, reconnect flush, no
duplicates on a second flush, a lost answer, secret-like entries, `block`, the `allow` mapping,
0600/0700 permissions, unreadable lines) and `test_cron.py` (nightly exit code 4 for a stale
entry, counts, watchdog), against the fake Hermes and the fake Worldbuilder that validates every
request against `schemas/`.

## Pros and Cons of the Options

### Keep `allow`

- Good, because nothing is lost in the agent's memory.
- Bad, because the entry never reaches the board: the measured failure.

### Only `block`

- Good, because nothing bypasses the loop.
- Bad, because an outage stops the agent system's memory entirely; remains available as a setting.

### Allow, mark, record, flush

- Good, because both the owner's wishes hold.
- Bad, because of a local outbox with content in it (owner-only file, tombstones after the flush).

## More Information

- Supersedes: the `memory_on_error: allow` default of [ADR-0044](0044-hermes-integration-package.md)
  and its OQ-16. OQ-5 (only accepted agent cards count towards five a week) and OQ-9 (unclear
  memories stay in the agent's memory) were answered by the owner as the defaults and are unchanged.
- Related: [ADR-0036](0036-conclusions-are-private.md), [ADR-0039](0039-knowledge-loop-receipts.md),
  [ADR-0041](0041-usage-ledger-and-metrics.md), [ADR-0042](0042-memory-route-classification.md).
- How-to: [Connect Hermes in 5 minutes](../how-to/connect-hermes.md).
