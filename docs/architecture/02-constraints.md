# 2. Constraints

Constraints are given, not chosen in this documentation. Each row points to where it is
decided.

## 2.1 Technical constraints

| Constraint | Consequence | Source |
| --- | --- | --- |
| TypeScript `strict`, ESM only, Node 22 LTS, pnpm 10 workspaces | One language across UI, API, MCP server and adapters; shared types and validators | [ADR-0003](../adr/0003-typescript-monorepo-stack.md) |
| React + Vite for the board, `@xyflow/react` for the canvas | The canvas library's state is never persisted; the Lage format is | [ADR-0003](../adr/0003-typescript-monorepo-stack.md), [ADR-0019](../adr/0019-design-tokens-and-board-canvas.md) |
| Fastify for the Board API | HTTP routes validate against the JSON Schemas | [ADR-0003](../adr/0003-typescript-monorepo-stack.md) |
| Official `@modelcontextprotocol/sdk`, stdio and Streamable HTTP | MCP is the agent interface | [ADR-0016](../adr/0016-mcp-first-and-openapi-contracts.md) |
| JSON Schema 2020-12 is the single source of truth (Ajv); OpenAPI 3.1 references it | No zod or TypeScript type is canonical; types are generated or tested against the schemas | [ADR-0016](../adr/0016-mcp-first-and-openapi-contracts.md) |
| Markdown files with YAML front matter are the truth | Any index is derived; history is archived versions, not an event log | [ADR-0006](../adr/0006-files-are-the-truth.md) |
| Compatibility with the owner's card format v2 | Every v2 field maps 1:1 to the canonical model; writes are patches | [ADR-0023](../adr/0023-core-domain-model.md), [ADR-0027](../adr/0027-card-format-mapping-addenda.md), [card format](../reference/card-format.md) |
| Windows, macOS and Linux | CI matrix over three operating systems; `v0.1.0` only when M1 passes on all three | [ADR-0020](../adr/0020-build-order-milestones.md) |
| Browser only, no desktop shell | The board runs in the user's browser against a local service | [ADR-0003](../adr/0003-typescript-monorepo-stack.md) |
| Design tokens only until the brand design system lands | No hard-coded colours or fonts, no default component-library theme | [ADR-0019](../adr/0019-design-tokens-and-board-canvas.md) |

## 2.2 Organisational constraints

| Constraint | Consequence | Source |
| --- | --- | --- |
| Contract-first, then a walking skeleton (M1), then vertical slices (M2+) | M0 ships no features; architecture describes the target and marks the status | [ADR-0020](../adr/0020-build-order-milestones.md) |
| Trunk-based development, small pull requests, a reviewer before every merge, required CI checks | Building blocks must be changeable in isolation | [ADR-0025](../adr/0025-engineering-process-and-quality-gates.md) |
| "Prove, don't claim" | A capability counts only with an automated check in [verification](../verification.md) | [ADR-0020](../adr/0020-build-order-milestones.md), [ADR-0025](../adr/0025-engineering-process-and-quality-gates.md) |
| Synthetic data only; no owner infrastructure details | Examples, tests and diagrams use invented data; the owner's store is named generically | [ADR-0022](../adr/0022-public-hygiene.md) |
| Card intake is not our job | No ingestion component; sources are referenced and pinned | [ADR-0014](../adr/0014-no-ingestion-inbox-of-findings.md) |
| The owner decides the Jev interface and what may go to cloud models | The Jev connector stays a stub behind the gate until the interface is fixed | [ADR-0015](../adr/0015-two-thinking-levels.md) |
| Economy, card exchange, gamification and crypto are out of scope | Only `level` and `signature` are reserved; nothing is built on them | [ADR-0021](../adr/0021-privacy-and-sharing-model.md) |

## 2.3 Legal constraints

| Constraint | Consequence | Source |
| --- | --- | --- |
| Two-tier licensing: Apache-2.0 for the format, schemas, libraries and adapters; AGPL-3.0-or-later for the board app, the Board API and the MCP server | Apache-2.0 packages never import AGPL packages; dependency direction follows the licence tiers | [ADR-0004](../adr/0004-two-tier-licensing.md), [LICENSING.md](https://github.com/Reraise-ai/reraise-app/blob/main/LICENSING.md) |
| DCO sign-off, SPDX header in every source file, REUSE compliance | Checked in CI | [ADR-0004](../adr/0004-two-tier-licensing.md) |
| The hosted platform is a separate, closed service | Not part of this repository or of these diagrams beyond an external box | [ADR-0021](../adr/0021-privacy-and-sharing-model.md) |

## 2.4 Conventions

- Repository language is English; German domain terms only through the
  [glossary](../glossary.md) ([ADR-0002](../adr/0002-english-repository-language.md)).
- Conventional Commits, SemVer, Keep a Changelog
  ([ADR-0025](../adr/0025-engineering-process-and-quality-gates.md)).
- Documentation follows Diátaxis; architecture follows arc42 with C4 diagrams in Mermaid
  ([ADR-0025](../adr/0025-engineering-process-and-quality-gates.md)).
- Every change to a schema, the OpenAPI contract, MCP tool definitions, an adapter interface or
  the product canon needs an ADR ([ADR-0001](../adr/0001-record-architecture-decisions.md)).
