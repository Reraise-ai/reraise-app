---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0009: Provenance is mandatory; independence counts distinct origins

## Context and Problem Statement

The canon says provenance is mandatory and that 10,000 copies of one
agency report are one origin, not independent confirmation. The gap audit
found provenance missing on players, moves, assumptions and decisions in
the first prototype. The owner's card format v2 already rejects player
entries without a source. Which provenance rules does the product enforce,
and how is independence counted?

## Decision Drivers

- No claim without a traceable origin.
- Counting cards must never look like counting confirmations.
- Player fields (interests, capabilities, dependencies, moves) drive game
  analysis and must be sourced.
- Rules must be enforceable by validators, not just by UI hints.

## Considered Options

- Provenance optional, UI warns when missing
- Provenance mandatory only for `evidenced` cards
- Provenance mandatory by layer and on every player field (chosen)

## Decision Outcome

Chosen option: "Provenance mandatory by layer and on every player field",
because it is the only option validators can enforce and it matches card
format v2.

- Every card has `author` (`human` or `agent:<name>`).
- `layer: evidenced` and `layer: said` require `source` or `originSystem`.
- `layer: experience` requires `author`.
- Player fields `interests`, `capabilities`, `dependencies`, `moves` are
  lists of `{text, source}`; `source` (card id or URI) is required. An
  unsourced entry is rejected; an own assessment must first be a card of
  its own (`layer: said`, author = the user) that the entry can cite.
- Every edge records `by` (who drew it), see
  [ADR-0023](0023-core-domain-model.md).
- Independence: the number of distinct origin roots, computed in
  `packages/core` by following `cites` and `based_on` edges and source
  identity to their roots. Same `contentHash` or same source URI = same
  root; one speaker quoted by many media = one root; unknown origin counts
  as its own root and is flagged. The board shows "N findings · M
  origins", never a bare card count.
- Agent-originated content keeps `author: agent:<name>` after acceptance
  ([ADR-0011](0011-agent-moves-are-proposals.md)).

### Consequences

- Good, because players, moves and decisions become auditable.
- Good, because apparent consensus from copies is visible as one origin.
- Bad, because quick unsourced notes are rejected; users must create a
  said card first, which is slower.
- Bad, because independence is only as good as the `cites` / `based_on`
  edges users and connectors record.

### Confirmation

JSON Schema rules and invalid examples for each provenance rule;
`packages/core` unit tests for origin-root counting (copies, quote chains,
cycles, unknown origin); conformance tests for player-field sources.

## Pros and Cons of the Options

### Optional with warnings

- Good, because frictionless capture.
- Bad, because the gap audit shows warnings are ignored.

### Mandatory only for evidenced

- Good, because light.
- Bad, because said claims and player fields stay unsourced.

### Mandatory by layer and player field

- Good, because enforceable and compatible with card format v2.
- Bad, because more friction.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §4.1 (`PlayerEntry` with
  possibly empty `basisCardIds` as "own assessment", and `redLines` as a
  fifth player field, dropped from the contract, see
  [ADR-0024](0024-concept-v1-reconciliation.md)). The origin-root idea of
  §6 is kept, re-keyed on `contentHash` / URI instead of blob hashes.
- Related: [ADR-0007](0007-epistemic-layer-field.md),
  [ADR-0018](0018-multidimensional-source-profile.md),
  [ADR-0023](0023-core-domain-model.md).
