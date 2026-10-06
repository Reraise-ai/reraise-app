---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0034: Content hash is SHA-256 over the JCS serialisation of the card content

## Context and Problem Statement

[ADR-0006](0006-files-are-the-truth.md) and [ADR-0021](0021-privacy-and-sharing-model.md)
define `contentHash` as "SHA-256 over the canonical card content", used for optimistic
concurrency and to recognise identical content as one origin
([ADR-0009](0009-mandatory-provenance.md)). Neither fixes which fields are hashed nor how they
are serialised, so two adapters could compute different hashes for the same card. How exactly
is the content hash computed?

## Decision Drivers

- The same content yields the same hash in every adapter, language and runtime.
- Store identity, reserved fields and store-carried fields must not change the hash.
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

- Input: the canonical card content (`card.schema.json#/$defs/content`) without `id`,
  `externalId`, `uri`, `contentHash`, `signature`, `level` and the store-carried fields
  `typeRaw`, `rating`, `carrier` and `affiliation` ([ADR-0023](0023-core-domain-model.md)).
  Stance data is not part of the card and therefore never hashed. Members whose value is
  absent are omitted; every other field, including `body`, is hashed.
- Serialisation: RFC 8785. Object keys are sorted by UTF-16 code units, strings and numbers
  use the ECMAScript JSON rules, no whitespace. Text is hashed as stored: no Unicode
  normalisation is applied, so differently normalised text yields a different hash.
- Hash: SHA-256 over the UTF-8 bytes, written as `sha256:` plus 64 lower-case hex digits.
- Every card an adapter returns carries `contentHash`, computed on read, never trusted from
  storage. Drafts may omit it; the store recomputes it.
- `computeContentHash` and `canonicalJson` in `packages/core` are the reference
  implementation.

### Consequences

- Good, because every adapter computes the same hash, testable with published vectors.
- Good, because changes to store-only fields or identity do not look like content changes.
- Bad, because the hash covers user metadata such as `worlds`, `visibility`, `class` and
  `training`, so the same text in two stores may hash differently; cross-user origin matching
  needs its own key when the platform work starts.
- Bad, because adding a canonical field changes the hash of cards that use it.

### Confirmation

Unit tests in `packages/core` with the RFC 8785 example, key order, Unicode and number
formatting vectors and a pinned card vector; the fixture reader repeats the pinned vector;
the conformance kit checks that every card read carries the hash of its content and that a
patch changes it.

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
