---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0033: In-memory derived index for the reference adapter; SQLite only on measured need

## Context and Problem Statement

[ADR-0006](0006-files-are-the-truth.md) allows any database only as a derived index that can be
deleted and rebuilt from the files. The reference `markdown-files` adapter needs search and
lookups (cards by id, worlds, edges) for M1. Which technology does it use?

## Decision Drivers

- Files are the truth; the index is disposable.
- Few dependencies, portable to Windows, macOS and Linux without native builds.
- M1 data volumes are small (synthetic example worlds).
- Files can change outside the product (sync tools, editors, other agents).

## Considered Options

- In-memory index rebuilt at start, refreshed by a file watcher (chosen)
- SQLite (`node:sqlite` or `better-sqlite3`) with full-text search from the start
- No index; scan the files on every query

## Decision Outcome

Chosen option: "In-memory index rebuilt at start, refreshed by a file watcher", because it needs
no native dependency, cannot drift into a second truth, and is fast enough at M1 scale.

- At startup the adapter scans its card files and builds the index in memory.
- A file watcher refreshes entries when files change. Watcher events are hints only: the adapter
  re-reads the affected file and compares `contentHash`; when events are unreliable or lost
  (platform differences in file watching), a full rescan restores a correct index.
- Archived versions (`_archive/`) are indexed only for history queries, never as current cards.
- SQLite (`node:sqlite` or `better-sqlite3`) is introduced only when a measured need appears
  (for example query latency or memory on a realistic store), recorded with the measurement in a
  new ADR. It stays a derived, rebuildable index.

### Consequences

- Good, because no native module and no database file to manage.
- Good, because rebuild-from-files is the normal start path, so it is always exercised.
- Bad, because start-up time and memory grow with store size.
- Bad, because file watching behaves differently per operating system; the rescan fallback is
  required.

### Confirmation

Conformance tests (M1): deleting and rebuilding the index yields identical query results; a file
changed outside the product is reflected after the watcher event or a rescan; no index state is
needed to derive canonical ids ([ADR-0023](0023-core-domain-model.md)).

Start-up warm-up: native watchers (FSEvents on macOS) start asynchronously and can miss changes
made right after they are created. Without writing any probe file to the store, the adapter
rescans on every query until both the cards and the root watcher have delivered an event or the
warm-up window (`watchWarmupMs`, default 3 s) ends, and forces one rescan at the end of the window.
Tests: a card or world file written right after open is visible to the very next query, also
through a symlinked root; the warm-up ends and the forced rescan happens.

## Pros and Cons of the Options

### In-memory with watcher

- Good, because simple and dependency-free.
- Bad, because scales only to moderate stores.

### SQLite from the start

- Good, because full-text search and scale.
- Bad, because a native dependency (or an experimental built-in) before any measured need.

### Scan on every query

- Good, because always current.
- Bad, because likely too slow beyond small stores (not measured).

## More Information

- Supersedes concept v1: `docs/04-architektur.md` §4 FTS5 and sqlite-vec as default storage
  (already changed to "derived only" by [ADR-0006](0006-files-are-the-truth.md)).
- Resolves open decision OD-6 of the [architecture documentation](../architecture/09-decisions.md).
- Related: [ADR-0005](0005-universal-adapter-architecture.md),
  [ADR-0006](0006-files-are-the-truth.md).
