# @worldbuilder/mcp-server

The MCP server of The Worldbuilder (AGPL-3.0-or-later): the agent tools of
[`src/tools.ts`](src/tools.ts), built on the official `@modelcontextprotocol/sdk`
([ADR-0016](../../docs/adr/0016-mcp-first-and-openapi-contracts.md),
[ADR-0029](../../docs/adr/0029-process-topology.md)).

- `server.ts`: `createToolServer`, one server per connection. It lists the tools with input and
  output schemas bundled from the contracts (`schema-bundle.ts`: self-contained, no file
  references) and runs every call through an injected `invoke`. It holds no store, no gate and no
  identity of its own; the caller of every call is the one of the HTTP request that carries it.
- `sessions.ts`: `McpSessions`, Streamable HTTP sessions bound to the agent that opened them,
  with a per-agent limit and idle expiry. It takes Node requests, so any HTTP server can host it.
- `bridge.ts`: the stateless stdio relay behind `worldbuilder mcp --stdio`.

The service (`services/api`) mounts this package at `/mcp` and implements `invoke` with the
operation code of its HTTP routes, so there is one write path. Tools are exactly the entries of
`tools.ts`: the `tools.test.ts` parity test proves each has an HTTP operation with the same
schemas and that every other operation is human-only.

Licence: AGPL-3.0-or-later.
