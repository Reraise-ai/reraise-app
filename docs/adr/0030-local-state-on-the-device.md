---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0030: Local state lives in files in the per-user state directory, owned by `packages/local-state`

> Extended by [ADR-0040](0040-receipt-log-and-verifier.md): the receipt log
> `<state>/receipt-log.jsonl` (append-only, hash-chained, never rotated) and the atlas pages of
> [ADR-0043](0043-digest-atlas-regeneration.md) (`<state>/atlas/` by default).

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
- Local files in a per-user state directory, owned by a dedicated package behind a core interface (chosen)
- An embedded database (for example SQLite) in the state directory

## Decision Outcome

Chosen option: "Local files in a per-user state directory, owned by a dedicated package behind
a core interface", because it keeps local state out of every shared store, stays readable as
plain files and needs no new runtime dependency.

### Location

The state directory (written `<state>` below) is, by default, the per-user operating-system
state directory:

| Operating system | Default `<state>` |
| --- | --- |
| Linux and other XDG systems | `$XDG_STATE_HOME/worldbuilder` (falling back to `~/.local/state/worldbuilder`) |
| Windows | `%LOCALAPPDATA%\Worldbuilder` |
| macOS | `~/Library/Application Support/Worldbuilder` |

- The user may configure another path explicitly.
- The service refuses to start if `<state>` resolves (after following symbolic links) inside any
  configured store root or inside a Git working tree, so local state cannot end up in a synced
  store or a commit.
- `.worldbuilder/` stays in `.gitignore` as a second line of defence
  ([ADR-0022](0022-public-hygiene.md)). This refines the `.worldbuilder/stances/` location of
  [ADR-0008](0008-believed-as-private-stance.md): stances live in `<state>/stances/`.

### Layout

| What | Path | Format |
| --- | --- | --- |
| Proposals | `<state>/proposals/<ulid>.json` | one JSON file per proposal, validated against the Proposal schema |
| Stances | `<state>/stances/` | one file per card with the current stance and its previous versions ([ADR-0008](0008-believed-as-private-stance.md)) |
| Gate decision log | `<state>/gate-log.jsonl` | append-only JSON Lines: card id, target, decision, reason, time; never card content. Rotated at 10 MB, keeping 5 rotated files by default; both limits are configurable |
| Gate rules | `<state>/gate-rules.yaml` | the rule language of [ADR-0031](0031-gate-rules-and-confirmation-binding.md) |

### Ownership

- All of it is files and local only. None of it is ever sent to a model, exported or shared.
- A new Apache-2.0 package `packages/local-state` implements the access. When it is created it
  gets its own `LICENSE` file and a row in `LICENSING.md`, like every package
  ([ADR-0004](0004-two-tier-licensing.md)). `core` defines the
  interface it implements, `LocalStateStore`, so `core` keeps no I/O and the
  package can be replaced.
- `services/api`, inside the single service process, is the only writer. The MCP bridge and
  agents never write local state directly; proposals reach it only through `proposal_create`
  handled by the service.
- Stances are written only through a human-only endpoint, `PUT /cards/{id}/stance`, which
  accepts the human screen session token only and never an agent token
  ([ADR-0026](0026-security-defaults.md)). This endpoint must be added to the OpenAPI contract.

### Implementation notes (M1)

- Proposals carry no sequence number (the Proposal schema is closed), so the change cursor is
  built from strictly increasing millisecond stamps in `createdAt` and `decidedAt`. If the wall
  clock steps back, new stamps continue one millisecond after the previous one and run ahead
  of the clock until it catches up; cursors stay valid and nothing is skipped or repeated. No
  schema change is needed.
- A damaged proposal or stance file (not JSON, schema-invalid, inner id different from the file
  name) is skipped in listings and reported by `damagedFiles()`; a stored proposal that does not
  validate never counts.
- At open the directory is set to owner-only permissions on POSIX, and the store refuses a
  state directory in which `proposals`, `stances`, `gate-rules.yaml` or a gate-log file is a
  symbolic link. An explicit state directory must be a local drive path on Windows (no UNC).
- Gate log entries carry a fixed reason code and an optional rule id, never prose.

### Consequences

- Good, because local state is inspectable, portable and never mixed into a shared store.
- Good, because the gate log can be audited without exposing content.
- Bad, because listing many proposals means reading many small files; acceptable at M1 scale and
  revisited with measurements.
- Bad, because a new package and a new core interface add surface that needs conformance-style
  tests.

### Confirmation

Tests (M1): proposals, stances and gate decisions are written only under `<state>`; the default
`<state>` resolves to the per-OS directory above on each CI operating system; the service refuses
to start when `<state>` is configured inside a store root or a Git working tree (also through a
symbolic link); the gate log rotates at the configured size and keeps the configured number of
files; the gate log contains no card text (fixture with a marker string that must not appear); the stance
endpoint rejects agent tokens; no MCP tool reads or writes stances; `packages/local-state`
imports no AGPL package.

## Pros and Cons of the Options

### Local state inside the card store

- Good, because one storage location.
- Bad, because stances and logs would travel with shared stores, contradicting ADR-0008 and
  ADR-0012.

### Files in a per-user state directory behind a core interface

- Good, because private by location, outside every store and repository, and readable.
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
