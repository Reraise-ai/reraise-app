---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0041: A derived usage ledger and exactly defined knowledge-loop metrics per agent and week

## Context and Problem Statement

The owner wants to see whether the knowledge loop works, per agent and per week, against four
targets: at least 80 % of tasks with a receipt over 7 days, at least 5 agent cards per week, an
atlas never older than 24 hours, and 10 decisions with an outcome. Without exact definitions
every tool counts differently, and a dashboard can look healthy while the loop is not. Where do
the numbers come from, and how is each one computed?

## Decision Drivers

- Files are the truth; anything derived is rebuildable ([ADR-0006](0006-files-are-the-truth.md)).
- Only accepted content counts as knowledge ([ADR-0011](0011-agent-moves-are-proposals.md)), but
  the habit of proposing is what is measured.
- The same numbers in the command line, the Board API and the board.
- Targets are the owner's current defaults, not constants.

## Considered Options

- A separate metrics store fed by events
- Counters inside the service, kept in memory
- A derived ledger computed by a pure function from files that already exist (chosen)

## Decision Outcome

Chosen option: "derived ledger", because every input already exists as a file and a pure
function gives the same numbers everywhere and can be tested exactly.

### Inputs (the ledger)

The ledger is not stored. `computeUsageMetrics(ledger, options)` in `packages/knowledge-loop`
derives everything from:

- the receipt log ([ADR-0040](0040-receipt-log-and-verifier.md)), after a successful chain check;
- task records and their verification results ([ADR-0040](0040-receipt-log-and-verifier.md));
- proposals in `<state>/proposals/` ([ADR-0030](0030-local-state-on-the-device.md));
- decision cards of the store (`type: decision`);
- the atlas pages and their staleness ([ADR-0043](0043-digest-atlas-regeneration.md)).

### Windows

- Weeks are ISO 8601 weeks in UTC: Monday 00:00:00 UTC (inclusive) to the next Monday
  (exclusive), written `YYYY-Www`.
- The rolling window is the 7 × 24 hours before `now` (`[now − 7 d, now)`).
- A record falls into a window by one time stamp: task records by `completedAt`, receipts by
  `at`, proposals by `createdAt` (counts of proposals) or `decidedAt` (counts of decisions on
  them).

### Per agent `a` and window `W`

| Field | Definition |
| --- | --- |
| `tasks` | task records with `agent = a` and `completedAt ∈ W` |
| `tasksWithReceipts` | of those, the records the verifier accepts (both receipts valid) |
| `receiptCoverage` | `tasksWithReceipts / tasks`; `null` when `tasks = 0` |
| `consults` | knowledge receipts with `agent = a`, `at ∈ W` |
| `consultsNothingFound` | of those, `result = nothing_found` |
| `writeBacks` | write-back receipts with `agent = a`, `at ∈ W` |
| `writeBacksNotNeeded` | of those, `result = not_needed` |
| `cardsProposed` | proposals with `author = a`, `kind = create_card`, `createdAt ∈ W` (decision drafts included) |
| `decisionsProposed` | of those, proposals whose card has `type: decision` |
| `outcomesProposed` | proposals with `author = a`, `kind = record_outcome`, `createdAt ∈ W` |
| `cardsAccepted` | proposals with `author = a`, `kind = create_card`, `status = accepted`, `decidedAt ∈ W` |
| `cardsRejected` | the same with `status = rejected` |

`totals` holds the same fields summed over all agents; its `receiptCoverage` is
`Σ tasksWithReceipts / Σ tasks`, not a mean of ratios. Agents appear if any count is non-zero,
sorted by name.

### Global values

- `decisions.total`: decision cards in the store; `decisions.withOutcome`: those whose
  `sections.outcome`, trimmed and lower-cased, is not `open`. Not windowed: the target is a
  running count. `null` when no store was given.
- `atlas.lagHours`: `0` when every atlas page is fresh; otherwise the largest
  `now − generatedAt` over the stale pages, in hours (one decimal); `null` when there is no atlas
  page. "Fresh" and "stale" are defined in [ADR-0043](0043-digest-atlas-regeneration.md). The
  lag measures how long an out-of-date atlas has been served, not the age of a correct one.

### Targets

Defaults, overridable per installation (`--target id=value` on the command line, a settings
file of the service later):

| `id` | Value | Comparison | Default |
| --- | --- | --- | --- |
| `receipt_coverage_7d` | `totals.receiptCoverage` over the rolling window | at least | 0.8 |
| `agent_cards_7d` | `totals.cardsProposed` over the rolling window | at least | 5 |
| `atlas_lag_hours` | `atlas.lagHours` | at most | 24 |
| `decisions_with_outcome` | `decisions.withOutcome` | at least | 10 |

A target whose value is `null` (no tasks, no atlas, no store) is **not met**: missing evidence
never counts as success. The metrics carry no score, rank or overall verdict; each target is
reported on its own.

### Contract and surfaces

- `schemas/usage-metrics.schema.json` (`UsageMetrics`): `generatedAt`, `window`
  (`{kind: rolling_7d | iso_week, start, end, isoWeek?}`), `agents[]`, `totals`, `decisions`,
  `atlas`, `targets[]` (`{id, comparison, threshold, value, met}`).
- Board API: `GET /metrics/usage` (`usage_metrics_get`, human-only, optional `week`); it is not
  an MCP tool: the numbers describe agents and are for the human. The board panel and the
  service route are built in the service slice.
- `wb metrics [--week YYYY-Www] [--log] [--tasks <dir>] [--proposals <dir>] [--store <dir>]
  [--atlas <dir>] [--target id=value] [--json] [--check]`. Exit codes: **0** done (with
  `--check`: every target met); **1** with `--check`: at least one target not met; **2** usage
  error or unreadable input; **3** the receipt log is broken.

### Consequences

- Good, because every number has one formula, and the formulas are tested.
- Good, because nothing new is stored; deleting nothing loses nothing.
- Bad, because counting tasks needs task records; a task the agent system never reports is not
  in the denominator. The agent-system integration must emit a record for every task.
- Bad, because each computation reads all inputs; fine at the expected scale (thousands of
  receipts), revisited with measurements.

### Confirmation

`packages/knowledge-loop` metrics tests with a synthetic ledger: ISO week boundaries (including
a week 53 and a year change), the rolling window, every field, ratio of sums, `null` handling,
each target met and not met, override of a target; the result validates against
`usage-metrics.schema.json`. Schema fixtures: a valid metrics document; invalid ones with a
coverage above 1, a target without `met` and an unknown window kind.

## Pros and Cons of the Options

### Separate metrics store

- Good, because fast queries.
- Bad, because a second truth that can drift.

### In-memory counters

- Good, because cheap.
- Bad, because lost on restart and not available offline to CI.

### Derived ledger

- Good, because exact, testable and offline.
- Bad, because recomputed on every request.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0039](0039-knowledge-loop-receipts.md),
  [ADR-0040](0040-receipt-log-and-verifier.md),
  [ADR-0043](0043-digest-atlas-regeneration.md), [owner questions](../owner-questions.md).
