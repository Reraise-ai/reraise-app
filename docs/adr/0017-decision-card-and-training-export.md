---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0017: Decision card with eleven sections, outcome loop, opt-in training export

## Context and Problem Statement

The canon's loop is experience → card → world → board → analysis →
decision → action → outcome → new experience. The owner defined a decision
card with eleven sections (card format v2). The gap audit requires that
all eleven are stored and that recording an outcome closes the loop. The
owner also wants cards and decisions exportable for fine-tuning, to gain
consistency in decision style, not to move facts into model weights.

## Decision Drivers

- 1:1 with the owner's decision card v2.
- The loop must close: outcomes update statistics.
- Weights cannot carry provenance or the evidenced/said split; facts stay
  retrievable cards.
- Training use is per-card opt-in.

## Considered Options

- Free-form decision note
- Concept v1 `DecisionData` (options with pro/contra columns, chosen
  option, own forecasts, review date, snapshot)
- Eleven fixed sections plus outcome loop and opt-in export (chosen)

## Decision Outcome

Chosen option: "Eleven fixed sections plus outcome loop and opt-in
export", because it maps 1:1 to the owner's store and yields uniform
decision traces for training.

- A decision card has exactly these sections, none empty: `situation`,
  `trigger`, `conditions`, `facts`, `priorities`, `action`,
  `alternatives`, `exclusions`, `rationale`, `cardsUsed`, `outcome`.
  `cardsUsed` ids must exist. `outcome` is `open` until known.
- Saving a decision is a human-only operation
  ([ADR-0016](0016-mcp-first-and-openapi-contracts.md)); agents may only
  propose content.
- Outcome loop (M2 slice): recording an outcome updates rule statistics,
  hit statistics of forecasts referenced in `cardsUsed`, and source
  profiles ([ADR-0018](0018-multidimensional-source-profile.md)); it may
  create a proposal for a new experience card.
- Training export (`packages/training-export`): JSONL, one decision trace
  per line (decision card, referenced card ids, Lage version, accepted
  brainstorm trace, outcome). Only cards with `training: true` are
  exported with content (default `false`); others appear as ids only.
- The export is a local file; it passes the disclosure gate and never
  contains stances.
- Fine-tuning itself is out of scope until enough decisions with outcomes
  exist and a consistency test shows a gain over the base model with
  context packages.

### Consequences

- Good, because decisions are structured, comparable and exportable from
  the first persistence slice.
- Good, because training targets decision style; facts remain cards with
  provenance.
- Bad, because concept v1 fields without a section (review date, separate
  process-vs-outcome rating, attached own forecasts) are not in the
  contract; they need an ADR in the decision slice and must not change the
  eleven sections.

### Confirmation

Decision schema tests (missing section, empty section, unknown
`cardsUsed` id rejected). Training-export tests: `training: false` cards
never appear with content; output is valid JSONL against its schema.

## Pros and Cons of the Options

### Free-form note

- Good, because flexible.
- Bad, because not comparable or trainable.

### Concept v1 DecisionData

- Good, because richer (options as columns, forecasts, snapshots).
- Bad, because does not map to the owner's card format.

### Eleven sections

- Good, because uniform and compatible.
- Bad, because options and forecasts live in prose sections.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §11.2 `DecisionData`,
  `docs/02-ux-board.md` §4 phase 5 decision form, and
  `docs/05-roadmap.md` §3 "Eigenes Embedding-Training, Fine-Tuning: nicht
  vorgesehen" (export is now in scope, fine-tuning later).
- Related: [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0018](0018-multidimensional-source-profile.md),
  [ADR-0023](0023-core-domain-model.md).
