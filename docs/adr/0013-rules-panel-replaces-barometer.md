---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0013: A rules panel replaces the probability barometer

## Context and Problem Statement

Concept v1 had a "premise barometer" counting supporting and weakening
origins with layer weights, and the first prototype showed a ratio meter
such as "Hold 69 : 31". The owner rejected any meter of this kind because
it reads as the system's verdict. The canon says the user decides; the
system shows the situation. What does the board show instead?

## Decision Drivers

- No percentage or ratio that looks like a judgement by the system.
- Make the user's own decision logic visible and checkable.
- Rules must be data, not hard-coded (gap-audit finding).
- Only accepted content may influence the result
  ([ADR-0011](0011-agent-moves-are-proposals.md)).

## Considered Options

- Barometer as a count of origins per layer with weights (concept v1)
- Ratio meter with a percentage (first prototype)
- Rules panel: which of the user's rules fire right now (chosen)

## Decision Outcome

Chosen option: "Rules panel", because it answers "which of my rules apply
right now, and why" without the system taking a position.

- `Rule` = `{id, when, then, unless, …}`: `when` and `unless` are
  conditions referencing cards, tags or card fields; `then` is the user's
  preferred action. Rules are user-authored cards (type `rule`), stored
  like any other card; the exact shape is fixed in the Rule schema.
- `rules_evaluate(lage)` returns a list: per rule `fired: true | false`,
  the triggering card ids, and unmet or unknown conditions. No percentage,
  no score, no aggregate, no "net" field, no recommended option.
- Only accepted cards count as triggers; pending or rejected proposals and
  level-1 answers never trigger a rule.
- Conditions may reference the user's own stances. When `rules_evaluate`
  answers a non-screen target (an MCP client or model,
  [ADR-0012](0012-disclosure-gate.md)):
  - rules with any stance-dependent condition are omitted entirely; the
    result only reports their number as `withheld: n`;
  - for every other rule it returns the rule id, `fired`, and the
    triggering card ids filtered by the gate for that target;
  - the rule text (`when`, `then`, `unless`) is included only if the rule
    card itself is gate-cleared for that target, including the
    per-transfer confirmation for `cloud_model`.
- The panel shows the rule's own `then` text as the user wrote it; it does
  not combine several rules into a recommendation.
- Provenance counts ("N findings · M origins", [ADR-0009](0009-mandatory-provenance.md))
  stay available as information about evidence, never as a gauge.

### Consequences

- Good, because the board mirrors the user's logic instead of replacing it.
- Good, because rules are testable data and feed rule statistics in the
  outcome loop ([ADR-0017](0017-decision-card-and-training-export.md)).
- Bad, because a user without rules sees an empty panel; onboarding must
  offer rule templates.
- Bad, because the at-a-glance balance of evidence is gone by design.

### Confirmation

The `rules_evaluate` result schema has no numeric score field (schema
test). Unit tests: fired / not fired with triggering ids; stance-dependent
rules withheld and counted for non-screen targets; proposals never
trigger. Reviewers reject any UI element that aggregates evidence into a
percentage.

## Pros and Cons of the Options

### Barometer as counts

- Good, because transparent counts.
- Bad, because layer weights and side-by-side totals still read as a
  verdict.

### Ratio meter

- Good, because instantly readable.
- Bad, because explicitly rejected by the owner.

### Rules panel

- Good, because shows the user's own logic.
- Bad, because needs authored rules to be useful.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §6.4 (`LAYER_WEIGHT`,
  `BarometerResult`), `docs/02-ux-board.md` §3 status bar barometer, §4
  phase 4 barometer and §5.3 barometer row, the "Was würde ich tun?"
  recommendation in §7 (reduced to the fired-rules list), and the MCP tool
  `decision_rules_for` (now `rules_evaluate`).
- Related: [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0015](0015-two-thinking-levels.md),
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md).
