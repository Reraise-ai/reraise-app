---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0006: Files are the truth, indexes are derived

## Context and Problem Statement

Concept v1 made an append-only SQLite event log the single source of truth,
with all objects as projections. Meanwhile the owner's card store went
live with Markdown files and YAML front matter, a single write channel
with lock and validator, archived versions on rewrite, and a search index
that can be deleted and rebuilt at any time. Our reference adapter must be
compatible with it. What is the canonical persistence model?

## Decision Drivers

- Compatibility with the owner's card format v2 and its conventions.
- Users own and can read their data without our software.
- Works with Git, sync tools and other agents that edit Markdown.
- History must be kept; nothing is deleted.
- Indexes (full text, vectors, graph caches) must be disposable.

## Considered Options

- Append-only event log in SQLite as truth (concept v1)
- Markdown files with YAML front matter as truth, derived indexes
- Database as truth with Markdown export

## Decision Outcome

Chosen option: "Markdown files with YAML front matter as truth, derived
indexes", because it matches the owner's live store, keeps data readable
and portable, and lets any database be rebuilt from the files.

- One card per file: YAML front matter for fields, Markdown body for text.
  The `markdown-files` reference adapter follows the owner store's
  conventions (field set mapped per [ADR-0023](0023-core-domain-model.md)).
- A Lage is a card of type `lage` whose state is a JSON block in the body.
- Rewriting a Lage or other versioned card moves the previous version to
  an archive (`_archive/<file>.v<n>.md`). Nothing is deleted. Validators
  ignore the archive.
- History = archived versions (plus Git if the user wants it), not an
  event log.
- Every write goes through one write path per store that validates before
  writing and holds a lock. Concurrent writers use optimistic concurrency
  on `version` / `contentHash`.
- `contentHash` = SHA-256 over the canonical card content.
- Any database (full-text, vector, graph cache) is derived, may be deleted
  at any time and is rebuilt from the files. Embeddings are optional and
  derived.

### Consequences

- Good, because the user's data is plain text that other tools can read.
- Good, because the reference adapter and the owner's store behave alike,
  so the conformance kit tests one behaviour.
- Bad, because fine-grained event replay ("state at sequence n") is gone;
  the time slider uses timestamps and archived versions instead.
- Bad, because file-level writes need locking and conflict handling that
  a database would give for free.

### Confirmation

Conformance tests: archive-on-rewrite keeps every previous version;
deleting and rebuilding the derived index yields identical query results;
`contentHash` is stable across round-trips.

## Pros and Cons of the Options

### Event log in SQLite

- Good, because exact replay and audit.
- Bad, because incompatible with the owner's live store and opaque to
  other tools; a projection bug corrupts the visible state.

### Files as truth

- Good, because portable, diffable, compatible.
- Bad, because queries need a derived index.

### Database as truth with export

- Good, because transactional writes.
- Bad, because the export becomes a second, drifting truth.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §1 rule 1 ("Wahrheit ist
  das Ereignislog"), §10 event log and write-permission table, §14
  invariant 9 (rebuild from log); `docs/04-architektur.md` §2 "eine
  SQLite-Datei" and §4 storage layout (events table, projections, FTS5,
  sqlite-vec, blob folder, `rebuild`), snapshot `upToSeq` in §9 of the data
  model (snapshots are now archived Lage versions).
- Related: [ADR-0005](0005-universal-adapter-architecture.md),
  [ADR-0023](0023-core-domain-model.md).
