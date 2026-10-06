---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0038: Player fields for red lines, assumed goals and a private personality type

## Context and Problem Statement

Actor cards carry four player fields, `interests`, `capabilities`, `dependencies` and `moves`,
each a list of `{text, source}` with a mandatory source
([ADR-0009](0009-mandatory-provenance.md), [ADR-0023](0023-core-domain-model.md)). Concept v1
also had red lines, which [ADR-0024](0024-concept-v1-reconciliation.md) (item 24) deferred
because card format v2 has no such field and the owner had not ruled. The owner decided on
2026-10-06:

- `redLines`: detected red lines, `text|source`, source required ("detected red lines are
  great information").
- For natural persons a private `personalityType` (for example an MBTI type). It is
  user-originated and therefore private ([ADR-0036](0036-conclusions-are-private.md)).
- For organisations `interests` (already there) plus `assumedGoals`, `text|source`; the source
  may be the user's own assessment card, and then the entry is private.
- German keys of the owner's card format: `rote_linien`, `persoenlichkeitstyp`,
  `angenommene_ziele`. The owner store must add them too.

These fields are also inputs of the level-1 engine ([ADR-0035](0035-level1-engine-socket.md)).
How do they enter the canonical card?

## Decision Drivers

- Provenance stays mandatory for every player-field entry.
- Lossless round-trip with the owner's card format ([ADR-0023](0023-core-domain-model.md)).
- Private by origin where the owner says so, enforced by the gate, not by convention.
- Minimal: reuse the existing player-entry shape.

## Considered Options

- Free text in the card body
- One generic `playerNotes` list with a kind per entry
- Three named canonical fields reusing the player-entry shape (chosen)

## Decision Outcome

Chosen option: "Three named canonical fields reusing the player-entry shape", because each
maps one to one to an owner key, keeps the mandatory source, and lets schema and gate treat
them precisely.

### Fields

| Canonical field | Shape | Allowed on | Owner store key |
| --- | --- | --- | --- |
| `redLines` | list of `{text, source}` (`text\|source` in front matter) | `collection: actors` | `rote_linien` |
| `assumedGoals` | list of `{text, source}` | `collection: actors` (persons and organisations) | `angenommene_ziele` |
| `personalityType` | one `{text, source}` (`text\|source`) | `collection: actors` and `type: person` | `persoenlichkeitstyp` |

- `source` is required everywhere and is a card id or an absolute URI, as for the other player
  fields. A red line or a goal the user only assumes cites the user's own assessment card,
  which must exist as a card of its own (`layer: said`, `author: human`,
  [ADR-0009](0009-mandatory-provenance.md)).
- `personalityType` is a single value, not a list, and only on natural persons (`type:
  person`). It is a canonical card field so that the round-trip with the owner store is
  lossless, but it is always private: it is never part of what is shared, whatever its source
  ([ADR-0036](0036-conclusions-are-private.md)). It may go to models under the normal gate
  rules, like any card content.
- An `assumedGoals` or `redLines` entry whose source is a card id is shared only if that
  entry is dropped or cites a public URI: the share projection of ADR-0036 keeps only player
  entries whose source is a public `http(s)` URI.
- All three are format-2 fields: a card that uses one is format 2.
- `redLines` and `assumedGoals` are content and join the content hash
  ([ADR-0034](0034-content-hash.md), `CONTENT_HASH_FIELDS`); cards without them hash as
  before. `personalityType` does not: it is the user's private assessment, like tags and class,
  and differs between users holding the same actor card.
- In the reference `markdown-files` format the fields are front-matter keys of the same name;
  list entries and the single personality type are written `text|source`, with the same
  comma and bracket limits as the other player fields.
- Owner adapter note: the owner store must accept `rote_linien`, `angenommene_ziele` and
  `persoenlichkeitstyp` in its validator and write channel, with the same `text|source` form
  and the same "only on actors" rule (`persoenlichkeitstyp` only on `typ: person`). Until it
  does, the owner adapter rejects patches that set these fields instead of dropping them.

### Consequences

- Good, because red lines and assumed goals become first-class, sourced inputs for players
  and for the level-1 engine.
- Good, because the personality type round-trips without ever being shareable.
- Bad, because the owner store must be extended before these fields can be written there.
- Bad, because `CONTENT_HASH_FIELDS` grows; existing hashes do not change (absent fields are
  omitted), but adapters must pick up the new list.

### Confirmation

- Schema: invalid fixtures for an unsourced red line, assumed goals on a non-actor, a
  personality type on an organisation, without a source and as a list; the Hormuz example
  carries red lines and assumed goals on both organisations and a person with a personality
  type that cites an own assessment card.
- Reader test in `scripts/markdown-cards.test.mjs`; content-hash tests in
  `packages/core/src/content-hash.test.ts`.
- Storage conformance kit: rejects an unsourced red line and a personality type on an
  organisation; round-trips all three fields.
- Gate and share projection tests of [ADR-0036](0036-conclusions-are-private.md): the
  personality type is never shared.

## Pros and Cons of the Options

### Free text in the body

- Good, because no schema change.
- Bad, because no source per entry, no gate treatment, no round-trip with owner keys.

### One generic list with a kind per entry

- Good, because one field for future kinds.
- Bad, because it does not map one to one to the owner's keys and hides the private
  personality type among shareable entries.

### Three named fields

- Good, because precise mapping, schema rules and gate rules per field.
- Bad, because three more fields to maintain.

## More Information

- Resolves [ADR-0024](0024-concept-v1-reconciliation.md) item 24 (player field `redLines`,
  deferred) and extends the card field mapping of [ADR-0023](0023-core-domain-model.md) and
  the content-hash field list of [ADR-0034](0034-content-hash.md).
- Supersedes concept v1: `docs/03-datenmodell.md` §4.1 `redLines` (now sourced, as decided
  here).
- Related: [ADR-0009](0009-mandatory-provenance.md),
  [ADR-0035](0035-level1-engine-socket.md), [ADR-0036](0036-conclusions-are-private.md).
