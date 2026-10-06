---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0020: Build order: contract-first, walking skeleton, vertical slices

## Context and Problem Statement

Concept v1 planned five sequential phases (0 click prototype, 1 my world
and board, 2 decide and follow up, 3 several worlds and rules, 4
platform), each a large horizontal layer. An operations-side roadmap for
the owner's store has its own phases 0–5. The UX concept and prototype
already exist. In which order do we build, and how do the plans map?

## Decision Drivers

- Something real end-to-end as early as possible.
- Contracts stable before parallel work by several agents.
- "Prove, don't claim": a milestone is done only when CI proves it.
- Real-path acceptance on the owner's store happens outside the repo.

## Considered Options

- UX first (build screens, derive the backend)
- Architecture first (complete design and all layers before features)
- Contract-first plus walking skeleton, then vertical slices (chosen)

## Decision Outcome

Chosen option: "Contract-first plus walking skeleton, then vertical
slices", because it fixes the interfaces early, proves the whole path
once, and then grows the product one end-to-end feature per pull request.

- **M0 Repository foundation and contracts** (no features): monorepo,
  tooling, CI, docs skeleton, ADR log, JSON Schemas, OpenAPI, MCP tool
  definitions, adapter interfaces, C4 and arc42 docs. Done when CI is
  green, schemas validate the examples, the ADR log is complete and the
  docs build.
- **M1 Walking skeleton**: board UI ↔ Board API ↔ `markdown-files`
  reference adapter ↔ MCP server, synthetic data, reference scenario
  geopolitics / Strait of Hormuz. Scenario: open a Lage, place a card,
  draw a `supports` edge, a test agent proposes a card via MCP, a human
  accepts, reload shows persisted state, a context package is generated,
  the gate blocks a private card for `cloud_model`. Done when one
  Playwright test runs it in CI.
- **M2+ Vertical slices**, one pull request each (UI + API + adapter +
  tests): decision card and outcome; rules panel; source profile and hit
  statistics; player fields with provenance; time slider; what-if layer;
  live channel (SSE); model connectors (local, cloud, Jev stub) with
  answers as proposals; source connectors (reference-then-pin); training
  export; world collision on two local worlds. Platform and sharing later.
- `v0.1.0` is released only when M1 passes on Windows, macOS and Linux.
- `docs/verification.md` maps each acceptance criterion to a test and CI
  job; anything unproven is labelled "in progress".

Mapping of earlier plans (kept in `docs/roadmap.md`):

| Earlier plan | New home |
| --- | --- |
| Concept phase 0 (click prototype) | done before M0; prototype frozen as design reference |
| Concept phase 1 (world, board, MCP) | M1 skeleton plus first M2 slices |
| Concept phase 2 (decide, follow up, profiles) | M2 slices: decision card, outcome loop, source profile, time slider |
| Concept phase 3 (several worlds, rules) | M2 slices: rules panel, world collision |
| Concept phase 4 (platform) | later, see [ADR-0021](0021-privacy-and-sharing-model.md) |
| Store-operations phases 0–5 | real-path acceptance per milestone, done outside the repo |

### Consequences

- Good, because parallel agents work against fixed contracts.
- Good, because each slice is demonstrable and reviewable.
- Bad, because M0 delivers no user-visible feature.
- Bad, because contracts may need revision once slices hit reality; every
  change goes through an ADR.

### Confirmation

Milestones and issues on the tracker; `docs/verification.md`; CI gates
(M1 e2e on three OS before `v0.1.0`).

## Pros and Cons of the Options

### UX first

- Good, because visible progress.
- Bad, because architecture derived from screens (forbidden by the
  hand-over).

### Architecture first

- Good, because complete design.
- Bad, because late feedback and big-bang integration.

### Contract-first and walking skeleton

- Good, because early end-to-end proof and safe parallelism.
- Bad, because an upfront contract investment.

## More Information

- Supersedes concept v1: `docs/05-roadmap.md` §1–§2 phase numbering and
  "done" criteria, §3 exclusions list (re-evaluated per slice), and §4
  open decision 1 (pilot scenario: decided, geopolitics / Hormuz).
- Related: [ADR-0016](0016-mcp-first-and-openapi-contracts.md),
  [ADR-0024](0024-concept-v1-reconciliation.md).
