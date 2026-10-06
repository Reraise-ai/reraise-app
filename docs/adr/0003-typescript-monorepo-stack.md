---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0003: TypeScript monorepo with pnpm, Node 22 and a fixed tool chain

## Context and Problem Statement

The product consists of a board UI, an HTTP Board API, an MCP server, a
domain core, several adapter packages, a disclosure gate, a training
exporter and an adapter conformance kit. They share one domain model and
one set of contracts. We need one language, one package layout and one
tool chain that every contributor and every agent uses the same way.

## Decision Drivers

- One domain model shared by UI, API, MCP server and adapters.
- The official MCP SDK and the board canvas library are TypeScript-first.
- Contract-first: JSON Schema and OpenAPI must be validated in CI.
- Reproducible on Windows, macOS and Linux (release gate, see
  [ADR-0020](0020-build-order-milestones.md)).
- Small, well-known tools; no speculative abstractions.

## Considered Options

- TypeScript monorepo (pnpm workspaces, Node 22 LTS)
- Python backend plus TypeScript frontend
- Rust core with a desktop shell (Tauri) and TypeScript UI

## Decision Outcome

Chosen option: "TypeScript monorepo", because one language across UI, API,
MCP server and adapters lets all of them import the same types and the
same validators, and the MCP SDK and canvas library are native to it.

Binding choices:

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict`, ESM only |
| Runtime | Node 22 LTS (`.nvmrc`, `engines`) |
| Packages | pnpm 10 workspaces |
| HTTP API | Fastify (`services/api`) |
| UI | React + Vite (`apps/board`) |
| Canvas | `@xyflow/react` ([ADR-0019](0019-design-tokens-and-board-canvas.md)) |
| MCP | official `@modelcontextprotocol/sdk` (`packages/mcp-server`) |
| Tests | Vitest, coverage v8 with a gate on `packages/core`; Playwright e2e from M1 |
| Lint / format | ESLint 9 flat config + typescript-eslint; Prettier 3 |
| Contracts | JSON Schema 2020-12 validated by Ajv + ajv-formats; OpenAPI 3.1 linted by `@redocly/cli` ([ADR-0016](0016-mcp-first-and-openapi-contracts.md)) |
| Docs site | VitePress, published to GitHub Pages |

Layout: `apps/board`, `services/api`, `packages/core`,
`packages/adapters/storage-markdown-files`, `packages/mcp-server`,
`packages/disclosure-gate`, `packages/training-export`,
`packages/conformance`, `schemas/` (JSON Schema and `openapi/`),
`examples/` (synthetic worlds), `prototype/` (frozen), `docs/`.
`packages/core` has no I/O; dependencies point towards `core`, never away
from it, and Apache-2.0 packages never import AGPL packages
([ADR-0004](0004-two-tier-licensing.md)).

### Consequences

- Good, because types and validators are shared without code generation
  across languages.
- Good, because the tool chain is mainstream and documented.
- Bad, because the owner's existing store tooling is not TypeScript; its
  adapter must call that store's write channel as an external process or
  service. The `StorageAdapter` interface allows this
  ([ADR-0005](0005-universal-adapter-architecture.md)).
- Bad, because Node adds a runtime dependency for end users (mitigated by
  a documented quickstart and, later, packaged releases).

### Confirmation

CI runs lint, format check, typecheck, unit tests with the coverage gate,
schema validation, OpenAPI lint and (from M1) Playwright on all three OS.

## Pros and Cons of the Options

### TypeScript monorepo

- Good, because single language and shared contracts.
- Bad, because Node tooling churn; pinned versions mitigate this.

### Python backend plus TypeScript frontend

- Good, because close to the owner's existing store tooling.
- Bad, because two type systems and duplicated validation; MCP and canvas
  live on the TypeScript side anyway.

### Rust core with desktop shell

- Good, because single binary distribution.
- Bad, because slower iteration and fewer contributors; a desktop shell
  is not needed (the board runs in a browser).

## More Information

- Supersedes concept v1: `docs/04-architektur.md` §3 package split
  (`store`, `context`, `ingest`, `llm`, `mcp`, `apps/server`, `apps/web`),
  zod as the schema source of truth (now JSON Schema, see ADR-0016),
  better-sqlite3 storage (see [ADR-0006](0006-files-are-the-truth.md)) and
  the optional Tauri shell (`docs/05-roadmap.md` §4 decision 2; dropped,
  browser only).
- Related: [ADR-0004](0004-two-tier-licensing.md),
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md).
