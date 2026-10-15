---
status: accepted
date: 2026-10-14
decision-makers: "Owner (product, roadmap time-slider slice), builder (contract shape)"
---

# ADR-0049: Archived Lage versions are a human-only read

## Context and Problem Statement

[ADR-0006](0006-files-are-the-truth.md) says history is archived versions, and the time slider
reads those versions rather than an event log. The store already keeps them
(`StorageAdapter.versions`). Nothing yet says how the board, which is only a client of the
Board API, reads them.

## Decision Drivers

- The board never reads the store itself (AC-23).
- A past board is the human's own view, not an agent tool ([ADR-0011](0011-agent-moves-are-proposals.md)).
- `lage_get` stays the current board so existing clients do not change.
- Until `v0.1.0` a contract change stays in `v0` and needs an ADR ([ADR-0028](0028-json-schema-contract-conventions.md)).

## Considered Options

- Add the archive to the `lage_get` body
- Replay an event log
- A human-only `GET /lagen/{lageId}/versions` that returns only replaced board states (chosen)

## Decision Outcome

Chosen option: "a human-only read of replaced board states", because the archive already exists
and `lage_get` must keep meaning "the board as stored now".

`lage_versions` (`GET /lagen/{lageId}/versions`) is `x-human-only` with the session token only,
so it is not an MCP tool. The body is `lageVersionList`: `versions`, oldest first. Each entry is
`version` (the archive number), `archivedAt` (when that state was replaced) and `lage` (the board
state). The current state is not an entry. An unknown Lage and a Lage the caller may not see are
both 404, as with `lage_get`.

The Lage in an entry is the archived board (question, options, placements, seats, edges). Card
bodies stay the current files. A card that no longer exists is withheld by the board, the same
way a missing placement is withheld today.

While the board shows an archived state it does not save that view.

### Consequences

- Good, because a rewrite already archives the previous Lage and this operation only reads it.
- Bad, because the card text on a past board is today's text, not the text of that date.

### Confirmation

`services/api/src/contract.test.ts` calls `lage_versions` after a save and expects the replaced
question. `services/api/src/security.test.ts` rejects an agent token. The board test moves the
slider and checks that the old question is shown and that no save is sent.

## Pros and Cons of the Options

### Archive inside `lage_get`

- Good, because one request loads the board and its history.
- Bad, because every current reader would receive a growing history, and a hidden failure of the
  archive would fail the board itself.

### Event log

- Good, because a sequence number could rebuild any instant.
- Bad, because [ADR-0006](0006-files-are-the-truth.md) already rejected it.

### Human-only `lage_versions` (chosen)

- Good, because the current board and the archive fail separately, and agents never see the route.
- Bad, because the board makes one extra request when a Lage opens.

## More Information

- Supersedes concept v1: nothing. [ADR-0024](0024-concept-v1-reconciliation.md) already maps time
  travel onto archived Lage versions.
- Related: [ADR-0006](0006-files-are-the-truth.md), [ADR-0016](0016-mcp-first-and-openapi-contracts.md).
