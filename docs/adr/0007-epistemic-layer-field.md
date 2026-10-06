---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0007: Epistemic kind is the field `layer`; `level` is reserved

## Context and Problem Statement

The canon never merges evidenced, said and believed into one "truth", and
treats own experience as evidence of its own kind. The hand-over first
proposed a card field `level ∈ {evidenced, said, experience}`. A later
owner decision reserves `level` for future card tiers (platform economy,
out of scope now). Concept v1 derived the layer from other fields
(`layerOf`), and the owner's store states it explicitly (`ebene`). Which
field name and which semantics do we use?

## Decision Drivers

- The name `level` is reserved by an owner decision.
- 1:1 mapping to the owner store's explicit `ebene` field.
- Experience must never be classed as believed (gap-audit finding).
- One stable English identifier in schemas, API and context packages.

## Considered Options

- `level` (first hand-over wording)
- `layer`, stated explicitly on the card
- Derived layer computed from evidence and speaker fields (concept v1)

## Decision Outcome

Chosen option: "`layer`, stated explicitly on the card", because `level`
is reserved and an explicit field maps 1:1 to the owner's store.

- `layer ∈ {evidenced, said, experience}`.
  - `evidenced`: traceable to a source or original. Says nothing about
    whether the content is true.
  - `said`: someone claimed it; the claimant is recorded.
  - `experience`: the user's own lived experience; evidence of its own
    kind, never "believed".
- "Believed" is not a layer value; it is a private stance overlay
  ([ADR-0008](0008-believed-as-private-stance.md)).
- Requirements follow card format v2 and apply only to format-2 cards
  ([ADR-0023](0023-core-domain-model.md)): `layer` is required when
  `format = 2` and `collection ∈ {evidence, actors}`; the provenance rules
  of [ADR-0009](0009-mandatory-provenance.md) apply when a `layer` is set.
- Legacy (format-1) cards may have no `layer`; they are valid and shown as
  "unclassified", never defaulted to a layer.
- `level` is reserved for card tiers. Schemas reserve the name; nothing in
  this repository may use it until an ADR defines it.
- Adapter mapping for card format v2: `ebene: belegt` → `evidenced`,
  `gesagt` → `said`, `erfahrung` → `experience`, `geglaubt` → see
  ADR-0008.
- Context packages use the same `layer` values (English), never a merged
  score across layers.

### Consequences

- Good, because the field is explicit, validated and identical across
  adapters, API, MCP and context packages.
- Good, because the owner's reserved name stays free.
- Bad, because the layer can disagree with the attached evidence; the
  provenance rules catch the important cases, the rest is the author's
  responsibility.

### Confirmation

Schema tests with valid and invalid examples (unknown layer value, `level`
used, believed as layer). Conformance tests for the `ebene` mapping.

## Pros and Cons of the Options

### `level`

- Good, because matches the first hand-over text.
- Bad, because it collides with the reserved tier field.

### Explicit `layer`

- Good, because unambiguous and mappable.
- Bad, because redundant with evidence fields in some cases.

### Derived layer

- Good, because cannot contradict evidence.
- Bad, because foreign stores state the layer explicitly and their cards
  lack our evidence structure; derivation would reclassify the user's own
  judgement.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §5.1 `layerOf`
  derivation, the experience card type as the carrier of the experience
  layer, and the German layer strings `BELEGT | GESAGT | ERFAHRUNG` in the
  context package (`docs/04-architektur.md` §7.3).
- Related: [ADR-0008](0008-believed-as-private-stance.md),
  [ADR-0009](0009-mandatory-provenance.md),
  [ADR-0023](0023-core-domain-model.md).
