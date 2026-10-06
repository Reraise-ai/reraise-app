---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0023: Core domain model compatible with the owner's card format v2

## Context and Problem Statement

The product needs one canonical model for cards, edges and Lagen (board
states) that every adapter maps to. The owner's live card store (card
format v2, German field names) must map 1:1, and concept v1 had a much
larger, event-sourced model (statements, premises, predictions, memberships,
lenses, snapshots). Which fields form the contract in M0?

## Decision Drivers

- 1:1 mapping of card format v2 ([ADR-0006](0006-files-are-the-truth.md)).
- Keep the model minimal; extend by ADR per slice.
- Platform readiness without building the platform
  ([ADR-0021](0021-privacy-and-sharing-model.md)).

## Considered Options

- Concept v1 model (typed `data` per card type, ten built-in types,
  memberships, per-lens layouts, snapshots)
- Card format v2 verbatim (German field names)
- A minimal English canonical model mapped 1:1 to card format v2 (chosen)

## Decision Outcome

Chosen option: "A minimal English canonical model mapped 1:1 to card
format v2", because it is the smallest model that carries the canon and
the owner's live data. Exact types live in the JSON Schemas.

Card fields: `id` (ULID), `externalId` / `uri` (foreign identity,
reference-by-URI), `contentHash` (SHA-256 of canonical content), `type`
(open vocabulary: person, organisation, actor, event, claim, source,
assumption, rating, decision, rule, topic, lage, …), `title`, `body`,
`layer` ([ADR-0007](0007-epistemic-layer-field.md)), `worlds[]`
(references, never copies), `source`, `sourceDate`, `originSystem`,
`author` (`human` | `agent:<name>`), `status`, `visibility`, `release`
(`private` | `community` | `commercial`), `training` (boolean, default
false), `edges[]`, player fields (`interests`, `capabilities`,
`dependencies`, `moves`, each `{text, source}`). Reserved, unused:
`level`, `signature`.

Edge: `{target, kind, by}` with `kind ∈ {supports, refutes, represents,
cites, based_on, depends_on, relation, unspecified}`.

Lage: `question` (required), `options[]`, `cards[{id, x, y}]`,
`seats[{name, kind: human | agent}]`, `edges[{from, to, kind, by}]`,
`version`, `updatedAt`. A rewrite archives the previous version.

Mapping card format v2 → canonical (implemented by adapters, rules tested
by the conformance kit):

| Card format v2 | Canonical |
| --- | --- |
| `typ`, `titel` | `type`, `title` |
| `quelle`, `quelle_datum`, `herkunft_system` | `source`, `sourceDate`, `originSystem` |
| `ebene` | `layer` (`geglaubt` → [ADR-0008](0008-believed-as-private-stance.md)) |
| `welten` | `worlds` |
| `urheber` (`mensch` / `agent:<name>`) | `author` (`human` / `agent:<name>`) |
| `training` (`ja` / `nein`) | `training` (`true` / `false`) |
| `freigabe`, `sichtbarkeit`, `status` | `release`, `visibility`, `status` (value lists 1:1 in the schema) |
| `kanten` `ziel\|art\|von` | `edges` `{target, kind, by}`; `stuetzt`→supports, `widerlegt`→refutes, `vertritt`→represents, `zitiert`→cites, `beruht_auf`→based_on, `abhaengig_von`→depends_on, `beziehung`→relation, `unbestimmt`→unspecified |
| legacy `verknuepfungen` | `edges` of kind `unspecified`, targets checked leniently |
| `interessen`, `faehigkeiten`, `abhaengigkeiten`, `zuege` | `interests`, `capabilities`, `dependencies`, `moves` |
| `einordnung` (own assessment of a foreign claim) | stance `note` of the user (private) |
| Lage `frage`, `optionen`, `karten`, `sitze`, `kanten`, `stand` | `question`, `options`, `cards`, `seats`, `edges`, `updatedAt` |

Store fields with no canonical counterpart yet (for example card date,
rating, sensitivity class, affiliation) are preserved unchanged by the
adapter; sensitivity classes feed disclosure-gate rules. Promoting such a
field to the canonical model needs an ADR.

### Consequences

- Good, because the owner's store and the reference adapter share one
  mapping, testable in the conformance kit.
- Good, because the model is small enough for M0 contracts.
- Bad, because concept v1 features (premises, predictions, memberships
  with role and weight, per-lens layouts) are not in the contract yet
  ([ADR-0024](0024-concept-v1-reconciliation.md)).

### Confirmation

JSON Schemas with valid and invalid synthetic examples for Card, Edge,
Lage and Stance; conformance tests for every mapping row.

## Pros and Cons of the Options

### Concept v1 model

- Good, because rich and already specified.
- Bad, because built on an event log and too large for the walking
  skeleton; does not map 1:1 to the owner's store.

### Card format v2 verbatim

- Good, because zero mapping for one store.
- Bad, because German identifiers and owner-specific fields in a universal
  contract.

### Minimal canonical model

- Good, because universal and mappable.
- Bad, because some owner fields are only carried, not understood.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §2–§4, §7–§9 (types
  `CardBase` with `data`, `Origin` / `AuthorRef`, `Visibility` enum,
  eleven relation types, `World` / `Membership` / `PremiseRef`, `Board`
  with phases, lenses, per-lens layouts and `BoardItem.parked`, `Snapshot`).
- Related: [ADR-0005](0005-universal-adapter-architecture.md),
  [ADR-0009](0009-mandatory-provenance.md),
  [ADR-0017](0017-decision-card-and-training-export.md).
