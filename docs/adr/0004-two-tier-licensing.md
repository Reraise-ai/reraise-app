---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0004: Two-tier licensing (Apache-2.0 and AGPL-3.0-or-later) with DCO

## Context and Problem Statement

The repository contains two kinds of code: reusable building blocks
(card format specification, schemas, libraries, adapters, conformance kit)
that third parties should embed freely, and the application (board app,
API service, MCP server) that should stay open when offered as a network
service. The hand-over first asked for a proprietary "All rights
reserved" licence until the owner decided; the owner has since decided.
A hosted card-exchange platform is planned as a separate service.

## Decision Drivers

- Adapter authors (including proprietary knowledge systems) must be able to
  implement our interfaces without copyleft obligations.
- Modified hosted versions of the application must stay open.
- A clean licence chain for every contribution.
- Machine-checkable licensing per file.

## Considered Options

- Two-tier: Apache-2.0 for spec/libraries/adapters, AGPL-3.0-or-later for
  the application
- Single permissive licence (Apache-2.0) for everything
- Single copyleft licence (AGPL-3.0-or-later) for everything
- Proprietary "All rights reserved" until later

## Decision Outcome

Chosen option: "Two-tier", because it maximises adoption of the format and
the adapter interfaces while keeping the application open when hosted.

| Tier | Licence | Paths |
| --- | --- | --- |
| Spec and libraries | Apache-2.0 | `packages/core`, `packages/adapters/*`, `packages/disclosure-gate`, `packages/training-export`, `packages/conformance`, `schemas/`, `examples/`, `docs/` (including the card format specification) |
| Application | AGPL-3.0-or-later | `apps/board`, `services/api`, `packages/mcp-server` |

- Full licence texts live in `LICENSES/`; each package has its own
  `LICENSE`; the root `LICENSE` points to `LICENSING.md`, which explains
  the split.
- Every source file starts with an SPDX header
  (an `SPDX-License-Identifier` tag naming `Apache-2.0` or
  `AGPL-3.0-or-later`), REUSE
  style. Copyright line: "Copyright The Worldbuilder contributors".
- Contributions require a Developer Certificate of Origin sign-off
  (`git commit -s`); there is no CLA.
- Apache-2.0 packages must not depend on AGPL packages.
- The hosted platform (card exchange, shared wiki) is a separate, closed
  service and is not part of this repository
  ([ADR-0021](0021-privacy-and-sharing-model.md)).

### Consequences

- Good, because anyone can write and ship an adapter under any licence.
- Good, because a hosted fork of the board or API must publish changes.
- Bad, because contributors must understand two licences; `LICENSING.md`
  and the per-package `LICENSE` make the tier explicit.
- Bad, because some companies avoid AGPL code; they can still use the
  Apache-2.0 tier.

### Confirmation

A CI job checks that every source file has an SPDX header matching the
tier of its path, and a lint rule forbids imports from AGPL packages
inside Apache-2.0 packages. CI checks the DCO sign-off on every commit.

## Pros and Cons of the Options

### Two-tier

- Good, because adoption and openness are balanced per component.
- Bad, because more licensing administration.

### Apache-2.0 only

- Good, because simplest.
- Bad, because a hosted closed fork of the application would be allowed.

### AGPL-3.0-or-later only

- Good, because strongest openness.
- Bad, because adapter authors for proprietary systems would be deterred.

### Proprietary until later

- Good, because it defers the choice.
- Bad, because a public repository without an open licence invites no
  contributions; the owner has already decided.

## More Information

- Supersedes: the hand-over's interim "LICENSE proprietary until the owner
  decides" (concept v1 had no licence).
- Related: [ADR-0003](0003-typescript-monorepo-stack.md),
  [ADR-0021](0021-privacy-and-sharing-model.md),
  [ADR-0022](0022-public-hygiene.md).
