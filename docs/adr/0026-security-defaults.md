---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0026: Security defaults for the Board API and the MCP server

## Context and Problem Statement

The Board API and the MCP server give access to a user's whole world,
including sensitive cards. Agents connect over MCP, the board UI over
HTTP, and some users will run the service on their own server instead of
their laptop. Concept v1 bound the server to loopback, used a random
session token and a bearer token for MCP over HTTP. Which defaults ship?

## Decision Drivers

- Secure by default; widening exposure must be a deliberate act.
- Human-only operations must not be reachable with agent credentials
  ([ADR-0011](0011-agent-moves-are-proposals.md)).
- Agent input is untrusted.
- Self-hosted deployments must stay possible.

## Considered Options

- Open by default, users add protection
- Full user accounts and login from the start
- Loopback binding and token-based access by default (chosen)

## Decision Outcome

Chosen option: "Loopback binding and token-based access by default",
because it protects a single-user local installation without the weight
of an account system, and allows a deliberate, documented widening.

- The Board API and the MCP HTTP transport bind to `127.0.0.1` by
  default. Binding elsewhere requires explicit configuration and is
  documented as "put your own access control (VPN, reverse proxy with
  authentication) in front". Documentation and examples use `127.0.0.1`
  and `localhost`; loopback addresses are on the allow-list of the
  "no real data" check ([ADR-0022](0022-public-hygiene.md)).
- The board UI uses a random session token created at start; CORS allows
  only the board's own origin.
- MCP over Streamable HTTP requires a bearer token per registered agent
  connection; the token identifies the agent (`agent:<name>`) and its
  disclosure target class ([ADR-0012](0012-disclosure-gate.md)). MCP over
  stdio inherits the identity configured for that process.
- Human-only endpoints (proposal accept / reject, Lage save, decision
  save, disclosure confirm) accept only the human session token, never an
  agent token.
- Provider credentials (model APIs, connectors) come from environment
  variables or the operating-system keychain, never from card files,
  exports or logs.
- All agent and HTTP input is schema-validated with size limits; content
  from sources and agents is treated as data, never as instructions or
  executable markup in the UI. Rejected requests are logged without
  card content.

### Consequences

- Good, because a default installation is not reachable from the network.
- Good, because agent and human privileges are separated by token type.
- Bad, because remote use needs extra setup by the user.
- Bad, because there is no multi-user model yet; it needs an ADR when the
  platform work starts ([ADR-0021](0021-privacy-and-sharing-model.md)).

### Confirmation

Integration tests: default bind address is loopback; human-only endpoints
reject agent tokens; MCP HTTP without a token is rejected; oversized or
schema-invalid input is rejected. The secret scan covers credential
leaks into the repository.

## Pros and Cons of the Options

### Open by default

- Good, because zero setup.
- Bad, because one misstep exposes the whole world.

### Accounts and login

- Good, because ready for many users.
- Bad, because heavy and out of scope for the single-user phase.

### Loopback and tokens

- Good, because safe and light.
- Bad, because remote access is manual.

## More Information

- Supersedes concept v1: nothing; it keeps `docs/04-architektur.md` §11
  (loopback binding, session token, MCP bearer token, keychain
  credentials, validated input) and adds the agent/human token split.
- Related: [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0012](0012-disclosure-gate.md),
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md).
