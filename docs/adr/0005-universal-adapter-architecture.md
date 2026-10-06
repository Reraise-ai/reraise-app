---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0005: Universal adapter architecture with reference-by-URI

## Context and Problem Statement

The owner decided that the Worldbuilder must work on top of any user's
second brain, knowledge store or multi-agent system. Cards are created in
the user's own systems (wikis, vaults, document pipelines, agent stores),
not by us. The owner's own card store is only one backend among many. How
does the product read, reference and write cards it does not own, and how
do model and privacy concerns plug in without binding to one vendor?

## Decision Drivers

- Universal: no assumption that we own the data.
- Cards may live in other systems; provenance must survive the hop.
- Open connector API for knowledge bases, legal databases, paid news,
  other agents' wikis.
- The LLM is replaceable; so is the store.
- Every backend must behave the same for the board.

## Considered Options

- Own central store; import everything from other systems
- Continuous replication of external stores into our database
- Adapter interfaces with reference-by-URI and a conformance kit

## Decision Outcome

Chosen option: "Adapter interfaces with reference-by-URI and a conformance
kit", because it is the only option that keeps the user's system the
owner of its data while giving the board one uniform contract.

Four interfaces, defined as TypeScript types in `packages/core` and
documented in `docs/reference/`:

| Interface | Responsibility | Writes? |
| --- | --- | --- |
| `StorageAdapter` | Read and write cards, worlds, Lagen (board states), decision cards and archived versions in one backend; report capabilities | yes, through the backend's own write path and validator |
| `SourceConnector` | Search or list new findings in an external source and return references with provenance | no (read only) |
| `ModelConnector` | Send a gate-cleared context package or a level-1 request to a model and return the answer as a proposal or typed level-1 result | no direct writes |
| `DisclosureGate` | `decide(card, target)` before anything leaves the screen ([ADR-0012](0012-disclosure-gate.md)) | no |

- Reference-by-URI: every card has a canonical `id` (ULID), an
  `externalId` (its id in the home store) and a `uri`
  (`wb:<storeInstanceId>/<externalId>`) pointing to its home system,
  as defined in [ADR-0023](0023-core-domain-model.md). Cards are referenced,
  never copied, between worlds and between systems.
- `StorageAdapter.create` returns the canonical id, and updates are
  patches that leave all other store content verbatim
  ([ADR-0023](0023-core-domain-model.md)).
- The owner's card store is reached through a `StorageAdapter` that is
  developed and operated outside this repository against our contracts.
- The in-repo reference implementation is
  `packages/adapters/storage-markdown-files` (M1), using the same file
  conventions as the owner's store ([ADR-0006](0006-files-are-the-truth.md)).
- `packages/conformance` is a test kit every `StorageAdapter` must pass:
  contract shape, round-trip, provenance rules, archive-on-rewrite,
  derived-index rebuild and legacy mapping rules
  ([ADR-0008](0008-believed-as-private-stance.md)). In M0 it runs against
  an in-memory fake.
- Adapters may delegate to an external process or service (for example a
  store's own write channel); the interface does not assume Node-only
  storage.

### Consequences

- Good, because new backends need only an adapter that passes the kit.
- Good, because provenance (`uri`, `originSystem`) is kept per card.
- Bad, because cross-store queries are limited to what adapters expose;
  derived indexes may be needed per adapter.
- Bad, because the interfaces become a public API that needs versioning
  and an ADR per change.

### Confirmation

`packages/conformance` runs in CI against the in-memory fake (M0) and the
`markdown-files` adapter (M1). External adapters run the same kit.

## Pros and Cons of the Options

### Own central store with import

- Good, because simple queries.
- Bad, because it duplicates the user's data and breaks provenance and
  ownership; contradicts the owner's "intake is not our job" decision.

### Continuous replication

- Good, because fast reads.
- Bad, because sync conflicts and a second copy of sensitive data.

### Adapters with reference-by-URI

- Good, because data stays where it lives.
- Bad, because more interface design up front.

## More Information

- Supersedes concept v1: `docs/04-architektur.md` §1 and §4 (one local
  SQLite store per user as the only backend), §5 `LlmAdapter` and
  `EmbeddingAdapter` (now `ModelConnector`; embeddings are a derived-index
  concern of an adapter), §8 ingest package.
- Related: [ADR-0006](0006-files-are-the-truth.md),
  [ADR-0012](0012-disclosure-gate.md),
  [ADR-0014](0014-no-ingestion-inbox-of-findings.md),
  [ADR-0023](0023-core-domain-model.md).
