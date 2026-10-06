---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0018: Multi-dimensional source profile, never a single credibility score

## Context and Problem Statement

The canon asks "how often was analyst X right later?" and insists that a
source can be accurate but ideologically distant, or inaccurate but
valuable as a counter-perspective. A single credibility score would hide
exactly these differences. Concept v1 already designed a profile with
separate dimensions; the owner's list of dimensions differs slightly.
What does a source profile contain?

## Decision Drivers

- Never one score, never a "best source" ranking.
- Agreement with and deviation from the user's own world kept separate.
- Small samples must not look like evidence.
- Values derive from outcomes and are rebuildable.

## Considered Options

- Single credibility score
- Star rating per source
- Profile of separate dimensions, each with its sample size (chosen)

## Decision Outcome

Chosen option: "Profile of separate dimensions, each with its sample
size", because it is the only option that keeps accuracy, agreement and
counter-perspective value apart.

- Dimensions: `hitAccuracy`, `reliability`, `topicCompetence` (per topic),
  `agreement` (with the user's world), `deviation` (from the user's world),
  `sourceQuality` (quality of the sources it uses), `historicalPerformance`,
  `counterPerspectiveValue`.
- Each dimension carries its value and `n` (sample size). Below a minimum
  `n` the UI shows "insufficient data" instead of a value.
- There is no aggregate field, no overall sort by "best"; sorting is only
  by one chosen dimension.
- The profile is derived from resolved estimates and decision outcomes
  ([ADR-0017](0017-decision-card-and-training-export.md)); it is never
  edited by hand and can be rebuilt.
- `agreement`, `deviation` and `counterPerspectiveValue` use the user's
  stances and are computed and kept on the device only
  ([ADR-0008](0008-believed-as-private-stance.md)).
- Only accepted content counts ([ADR-0011](0011-agent-moves-are-proposals.md)).

### Consequences

- Good, because the profile explains why a source matters, not just how
  much.
- Good, because private comparisons stay private.
- Bad, because profiles are empty until outcomes exist; the UI must show
  "insufficient data" honestly for a long time.
- Bad, because eight dimensions need careful visual design.

### Confirmation

The SourceProfile schema has no aggregate score field and requires `n` on
each dimension (schema test). Unit tests for the minimum-`n` rule.

## Pros and Cons of the Options

### Single score

- Good, because simple.
- Bad, because contradicts the canon.

### Star rating

- Good, because familiar.
- Bad, because a single score in disguise.

### Separate dimensions

- Good, because faithful to the canon.
- Bad, because harder to read at a glance.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §12 dimension set
  (`hitRate` and `brier` become `hitAccuracy`, `valueOfDissent` becomes
  `counterPerspectiveValue`, `independence` moves to per-claim provenance
  in [ADR-0009](0009-mandatory-provenance.md); `reliability` and
  `historicalPerformance` are added). The Brier formula of §12 is a
  candidate for `hitAccuracy` and is decided in the source-profile slice.
- Related: [ADR-0010](0010-estimative-probability-scale.md),
  [ADR-0017](0017-decision-card-and-training-export.md).
