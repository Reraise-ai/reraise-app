---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0030: Local state lives in `.worldbuilder/` files, owned by `packages/local-state`

## Context and Problem Statement

Some state belongs to the user's device and not to any card store: proposals
([ADR-0011](0011-agent-moves-are-proposals.md)), stances
([ADR-0008](0008-believed-as-private-stance.md), which fixes only `.worldbuilder/stances/`),
the disclosure-gate decision log and the gate rules ([ADR-0012](0012-disclosure-gate.md)).
None of it may pass through a `StorageAdapter` of a shared or remote store. Where is it stored,
in which format, and which package owns it?

## Decision Drivers

- Files are the truth ([ADR-0006](0006-files-are-the-truth.md)); no database as primary store.
- Stances and the gate log never leave the device.
- `core` has no I/O; Apache-2.0 packages never import AGPL packages
  ([ADR-0003](0003-typescript-monorepo-stack.md), [ADR-0004](0004-two-tier-licensing.md)).
- One writer, matching the single service process ([ADR-0029](0029-process-topology.md)).

## Considered Options

- Store local state as extra fields or cards in the user's card store
- Local files under `.worldbuilder/`, owned by a dedicated package behind a core interface (chosen)
- An embedded database (for example SQLite) under `.worldbuilder/`

## Decision Outcome

Chosen option: "Local files under `.worldbuilder/`, owned by a dedicated package behind a core
interface", because it keeps local state out of every shared store, stays readable as plain
files and needs no new runtime dependency.

| What | Path | Format |
| --- | --- | --- |
| Proposals | `.worldbuilder/proposals/<ulid>.json` | one JSON file per proposal, validated against the Proposal schema |
| Stances | `.worldbuilder/stances/` | one file per card with the current stance and its previous versions ([ADR-0008](0008-believed-as-private-stance.md)) |
| Gate decision log | `.worldbuilder/gate-log.jsonl` | append-only JSON Lines: card id, target, decision, reason, time; never card content |
| Gate rules | `.worldbuilder/gate-rules.yaml` | the rule language of [ADR-0031](0031-gate-rules-and-confirmation-binding.md) |

- All of it is files, local only, and excluded by `.gitignore` (`.worldbuilder/` is already
  listed, [ADR-0022](0022-public-hygiene.md)). None of it is ever sent to a model, exported or
  shared.
- A new Apache-2.0 package `packages/local-state` implements the access. `core` defines the
  interface it implements (for example `LocalStateStore`), so `core` keeps no I/O and the
  package can be replaced.
- `services/api`, inside the single service process, is the only writer. The MCP bridge and
  agents never write local state directly; proposals reach it only through `proposal_create`
  handled by the service.
- Stances are written only through a human-only endpoint, `PUT /cards/{id}/stance`, which
  accepts the human screen session token only and never an agent token
  ([ADR-0026](0026-security-defaults.md)). This endpoint must be added to the OpenAPI contract.

### Consequences

- Good, because local state is inspectable, portable and never mixed into a shared store.
- Good, because the gate log can be audited without exposing content.
- Bad, because listing many proposals means reading many small files; acceptable at M1 scale and
  revisited with measurements.
- Bad, because a new package and a new core interface add surface that needs conformance-style
  tests.

### Confirmation

Tests (M1): proposals, stances and gate decisions are written only under `.worldbuilder/`; the
gate log contains no card text (fixture with a marker string that must not appear); the stance
endpoint rejects agent tokens; no MCP tool reads or writes stances; `packages/local-state`
imports no AGPL package.

## Pros and Cons of the Options

### Local state inside the card store

- Good, because one storage location.
- Bad, because stances and logs would travel with shared stores, contradicting ADR-0008 and
  ADR-0012.

### Files under `.worldbuilder/` behind a core interface

- Good, because private by location and readable.
- Bad, because file-per-object scaling limits.

### Embedded database

- Good, because fast queries.
- Bad, because opaque to the user and a second kind of truth beside the files.

## More Information

- Supersedes concept v1: nothing.
- Resolves open decision OD-2 of the [architecture documentation](../architecture/09-decisions.md)
  and adds `packages/local-state` to the layout of [ADR-0003](0003-typescript-monorepo-stack.md).
- Related: [ADR-0008](0008-believed-as-private-stance.md),
  [ADR-0011](0011-agent-moves-are-proposals.md), [ADR-0012](0012-disclosure-gate.md),
  [ADR-0029](0029-process-topology.md), [ADR-0031](0031-gate-rules-and-confirmation-binding.md).
