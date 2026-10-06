---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0029: One local service process hosts the Board API and the MCP server; stdio through a stateless bridge

## Context and Problem Statement

[ADR-0006](0006-files-are-the-truth.md) requires one write path per store that validates and
holds a lock. [ADR-0016](0016-mcp-first-and-openapi-contracts.md) provides two front ends, the
Board API (Fastify) and an MCP server with stdio and Streamable HTTP transports. An MCP server
over stdio is started by the agent host as its own process. If that process opened the stores
itself, there would be two writers per store, two gate instances and two proposal lists. How are
the processes laid out so that there is exactly one write path per store?

## Decision Drivers

- Exactly one writer per store, one lock, one disclosure gate, one proposal list.
- Agents that only speak MCP over stdio must still be able to connect.
- Loopback binding and token separation of [ADR-0026](0026-security-defaults.md) stay intact.
- Few moving parts for a single-user local installation.

## Considered Options

- Separate processes for the Board API and the MCP server, both opening the stores
- One service process with both front ends; stdio through a stateless bridge (chosen)
- MCP server as a separate process that is an HTTP client of the Board API, for every transport

## Decision Outcome

Chosen option: "One service process with both front ends; stdio through a stateless bridge",
because it keeps a single write path per store and serves stdio-only clients without a second
writer.

- One local Node process, the Worldbuilder service, hosts the Board API (Fastify) and the MCP
  server over Streamable HTTP at the path `/mcp` of the same server. Both front ends share one
  `core`, one disclosure gate and one adapter instance per store.
- The service binds to `127.0.0.1` by default ([ADR-0026](0026-security-defaults.md)). `/mcp`
  requires an agent bearer token; human-only endpoints require the human session token.
- MCP clients that only support stdio use a thin bridge command, `worldbuilder mcp --stdio`.
  The bridge forwards MCP messages between stdio and the running service's `/mcp` endpoint,
  using the agent token configured for that bridge process.
- The bridge holds no state, never opens a store, never writes files and never evaluates the
  gate. If the service is not running, the bridge fails with a clear error; it does not start a
  second writer.
- The MCP tool implementations live in `packages/mcp-server` (AGPL-3.0-or-later) and are
  mounted by the service; the bridge command ships with the same package.

### Consequences

- Good, because there is one writer, one lock and one gate per store by construction.
- Good, because MCP over HTTP and over stdio behave identically: both end in the same handler.
- Bad, because stdio clients need the service running; the bridge cannot work alone.
- Bad, because a fault in one front end can take down the other; acceptable for a single-user
  local service.

### Confirmation

Integration tests (M1): an MCP call through the bridge and the same call over `/mcp` return the
same result; the bridge opens no file (checked with a read-only temporary working directory);
`/mcp` without an agent token is rejected; the service binds `127.0.0.1` by default.

## Pros and Cons of the Options

### Separate processes, both opening the stores

- Good, because the processes are independent.
- Bad, because two writers per store contradict ADR-0006 and split the gate and the proposal
  list.

### One process, stdio through a stateless bridge

- Good, because single writer and identical behaviour across transports.
- Bad, because stdio depends on a running service.

### MCP server always as an HTTP client of the Board API

- Good, because also single writer.
- Bad, because every MCP call pays an extra hop and the MCP tools would have to be mirrored as
  agent-scoped REST endpoints first.

## More Information

- Supersedes concept v1: nothing.
- Resolves open decision OD-1 of the [architecture documentation](../architecture/09-decisions.md).
- Related: [ADR-0006](0006-files-are-the-truth.md),
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md),
  [ADR-0026](0026-security-defaults.md).
