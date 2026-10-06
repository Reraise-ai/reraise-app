---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0034: Content hash is SHA-256 over the JCS serialisation of the card content

> Amended by [ADR-0038](0038-player-fields-red-lines-goals-personality.md): `redLines` and
> `assumedGoals` join the hashed fields; `personalityType` does not.

## Context and Problem Statement

[ADR-0006](0006-files-are-the-truth.md) and [ADR-0021](0021-privacy-and-sharing-model.md)
define `contentHash` as "SHA-256 over the canonical card content", used for optimistic
concurrency and to recognise identical content as one origin
([ADR-0009](0009-mandatory-provenance.md)). Neither fixes which fields are hashed nor how they
are serialised, so two adapters could compute different hashes for the same card. How exactly
is the content hash computed?

## Decision Drivers

- The same content yields the same hash in every adapter, language and runtime.
- The same information in two stores must hash identically, so that copies count as one origin
  ([ADR-0009](0009-mandatory-provenance.md), [ADR-0021](0021-privacy-and-sharing-model.md)).
- Store identity, reserved fields and user or organisational metadata must not change the hash.
- Stance data never enters a card and never enters the hash
  ([ADR-0008](0008-believed-as-private-stance.md)).
- A published canonicalisation instead of an invented one.

## Considered Options

- Hash the stored file bytes
- Hash `JSON.stringify` of the card with sorted keys (own rules)
- Hash the RFC 8785 JSON Canonicalization Scheme (JCS) serialisation of the card content (chosen)

## Decision Outcome

Chosen option: "RFC 8785 (JCS) of the card content", because it is a published,
language-neutral canonical form, and the canonical card is already JSON.

- Input (CTO decision): only the substantive fields that identify the information itself:
  `type`, `title`, `body`, `layer`, `source`, `sourceDate`, `sourceChecksum`, `date`, the
  player fields (`interests`, `capabilities`, `dependencies`, `moves`) and the structured
  sections (`sections`, `lage`, `rule`). Absent fields are omitted.
- A card with structured content (`sections`, `lage` or `rule`) is hashed by that structure:
  its `body`, which only renders the structure (with headings in the store's language), is not
  hashed. The same decision in a German-heading store and in the reference format hashes the
  same (CTO decision).
- Excluded: identity (`id`, `externalId`, `uri`), `contentHash`, `signature`, `level`, and all
  user or organisational metadata: `worlds`, `visibility`, `release`, `class`, `status`,
  `training`, `tags`, `rating`, `carrier`, `affiliation`, `collection`, `author`,
  `originSystem`, `edges`, `typeRaw`, `format`. Stance data is not a card field and never
  hashed.
- Serialisation: RFC 8785. Only plain JSON values are accepted: a lone surrogate, `NaN`,
  `Infinity` or a non-plain object (`Date`, `Map`, class instances) is an error, never coerced.
  Object keys are sorted by UTF-16 code units, strings and numbers use the ECMAScript JSON
  rules, no whitespace. Text is hashed as stored: no Unicode normalisation is applied, so
  differently normalised text yields a different hash.
- Hash: SHA-256 over the UTF-8 bytes, written as `sha256:` plus 64 lower-case hex digits.
- Every card an adapter returns carries `contentHash`, computed on read, never trusted from
  storage. Drafts may omit it; the store recomputes it.
- `computeContentHash` and `canonicalJson` in `packages/core` are the reference
  implementation.

### Consequences

- Good, because every adapter computes the same hash, testable with published vectors.
- Good, because the same information in two stores, with different worlds, classes, authors or
  edges, hashes identically and counts as one origin.
- Good, because changes to metadata or identity do not look like content changes.
- Bad, because the hash cannot serve as the optimistic-concurrency guard for metadata changes
  (for example a changed `class`); adapters guard such writes by their own version or file
  state ([ADR-0006](0006-files-are-the-truth.md)).
- Bad, because adding a field to the hashed list changes the hash of cards that use it; that
  needs an ADR.

### Confirmation

Unit tests in `packages/core` with the RFC 8785 example, key order, Unicode and number
formatting vectors and a pinned card vector; the fixture reader repeats the pinned vector;
the conformance kit checks that every card read carries the hash of its content, that a patch
of the title changes it, and that metadata does not.

## Pros and Cons of the Options

### Stored file bytes

- Good, because trivial.
- Bad, because formatting, field order and store-only fields change the hash.

### Own sorted-key JSON

- Good, because simple.
- Bad, because number and string rules are not specified for other languages.

### RFC 8785 (JCS)

- Good, because standardised and language-neutral.
- Bad, because implementations must follow the number formatting exactly.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0006](0006-files-are-the-truth.md), [ADR-0009](0009-mandatory-provenance.md),
  [ADR-0023](0023-core-domain-model.md), [ADR-0028](0028-json-schema-contract-conventions.md).
