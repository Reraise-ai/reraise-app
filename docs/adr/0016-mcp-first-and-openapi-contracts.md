---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0016: MCP-first AI interface and an OpenAPI 3.1 Board API, contract-first

## Context and Problem Statement

The first target users run their own agent systems. Their agents must
read the active world, receive context packages and act on the board.
The board UI needs an HTTP API with human-only operations. Concept v1
sketched MCP tools and an HTTP API with zod schemas as the source of
truth. Which interfaces, and where do their contracts live?

## Decision Drivers

- "Connect your vault or agent in five minutes": MCP is first-class.
- One set of contracts for UI, agents and adapters.
- Agents must have exactly one write path ([ADR-0011](0011-agent-moves-are-proposals.md)).
- Contracts must be language-neutral for adapter authors in any language.
- Every contract ships with valid and invalid examples and tests.

## Considered Options

- MCP server plus OpenAPI 3.1 Board API, JSON Schema as source of truth
- HTTP API only (agents call REST)
- GraphQL API
- zod schemas in TypeScript as source of truth, other formats generated

## Decision Outcome

Chosen option: "MCP server plus OpenAPI 3.1 Board API, JSON Schema as
source of truth", because MCP is how agent systems connect today, the
board needs plain HTTP, and JSON Schema is readable by every language.

- Domain contracts: JSON Schema 2020-12 in `schemas/` with versioned
  `$id`, validated with Ajv. Each schema has valid and invalid synthetic
  examples and a test proving both.
- Board API: OpenAPI 3.1 in `schemas/openapi/`, referencing the same JSON
  Schemas, linted with Redocly. Implemented by `services/api` (Fastify).
- MCP server (`packages/mcp-server`, official SDK; stdio and Streamable
  HTTP). Tools in M0: `world_list`, `lage_get`, `cards_search`,
  `card_get`, `context_package_get`, `rules_evaluate`,
  `proposal_create` (the only write path), `proposal_list`. Tool input
  and output schemas reference the same JSON Schemas.
- The HTTP API mirrors the MCP tools and adds human-only endpoints:
  proposal accept / reject, Lage save, decision save, disclosure confirm.
  Agent credentials cannot call human-only endpoints.
- Every response leaving the process passes the disclosure gate
  ([ADR-0012](0012-disclosure-gate.md)).
- TypeScript types (and zod schemas, if any are used for Fastify route
  validation) are generated from or tested against the JSON Schemas; they
  never become a second source of truth.

### Consequences

- Good, because adapter and agent authors in any language read one
  contract.
- Good, because contract tests run without the app.
- Bad, because JSON Schema is more verbose than zod and TypeScript types
  must be kept in sync (generation or a type test).
- Bad, because two transports (MCP and HTTP) must stay consistent; the
  shared schemas and a parity test mitigate this.

### Confirmation

CI: schema validation of all examples, Redocly lint, a parity test that
every MCP tool has an HTTP counterpart with the same schemas, and a test
that `proposal_create` is the only MCP tool with side effects.

## Pros and Cons of the Options

### MCP plus OpenAPI, JSON Schema canonical

- Good, because agent-native and language-neutral.
- Bad, because two interfaces.

### HTTP only

- Good, because one interface.
- Bad, because agent systems need custom glue; slower onboarding.

### GraphQL

- Good, because flexible queries.
- Bad, because poor fit for MCP tools and human-only command endpoints.

### zod canonical

- Good, because concise TypeScript.
- Bad, because ties contracts to one language.

## More Information

- Supersedes concept v1: `docs/04-architektur.md` §6 tool names
  (`context_for` → `context_package_get`, `board_get` → `lage_get`,
  `decision_rules_for` → `rules_evaluate`, `propose_cards` and
  `prediction_log` → `proposal_create`; `source_profile_get` deferred to
  the source-profile slice) and zod as schema source (`docs/03-datenmodell.md`
  introduction, `docs/04-architektur.md` §3).
- Supersedes hand-over §4: "Fastify, OpenAPI-first, zod" for
  `services/api`; zod is allowed only as an artefact generated from the
  JSON Schemas, never canonical.
- Related: [ADR-0003](0003-typescript-monorepo-stack.md),
  [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0013](0013-rules-panel-replaces-barometer.md).
