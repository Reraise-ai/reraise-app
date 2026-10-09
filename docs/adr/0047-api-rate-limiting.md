---
status: accepted
date: 2026-10-09
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0047: The Board API limits requests per credential and locks an address out after failed credentials

## Context and Problem Statement

The service binds to loopback ([ADR-0026](0026-security-defaults.md)) and authenticates every
route with a session token or an agent token ([ADR-0029](0029-process-topology.md)). Static
analysis (CodeQL `js/missing-rate-limiting`) correctly noted that nothing limited how fast a
caller could try. Tokens carry 256 bits, so guessing is not realistic, but any local process can
reach the port, and a runaway agent can flood the service.

## Decision Drivers

- Use a maintained, MIT-licensed library rather than our own counter where one fits
  ([ADR-0004](0004-two-tier-licensing.md): an MIT dependency is allowed in AGPL code).
- Normal use (board polling every 2 seconds, MCP sessions, the e2e) must never be throttled.
- All local callers share one address, so an address-only limit would let one agent starve the
  human; and a limit keyed only by credential would let a guesser rotate guesses.

## Decision Outcome

Chosen option: two in-memory limits, both answered with `429` as an RFC 9457 problem (type
`too-many-requests`) and a `Retry-After` header, never with card content:

1. **Per credential**: the official `@fastify/rate-limit` plugin, keyed by the SHA-256 of the
   presented credential (the address when there is none). Default 600 requests per 60 seconds.
   `/health` and CORS preflights are exempt. `/mcp` is covered like every other route.
2. **Failed credentials per address**: after 10 rejected credentials in 60 seconds the address is
   refused for the rest of the window, a valid token included; otherwise a correct guess would
   pass at full speed. Memory is bounded (1024 addresses).

Both are configurable (`--rate-limit`, `--auth-failure-limit` of `worldbuilder serve`; the
`rateLimit` service option). The OpenAPI document declares the `429` response on every operation.

### Consequences

- Good, because brute force and flooding from a local process are slowed, with no new
  authentication state.
- Bad, because a local process that sends bad credentials can lock the human out for up to a
  minute from the same address. Accepted: a local process can already stop the service, and the
  board shows the problem with its `Retry-After`.
- Bad, because the limits are per process and lost on restart.

### Confirmation

`services/api/src/rate-limit.test.ts`: 429 problem with `Retry-After` and contract check, per
credential isolation, `/health` exempt, MCP covered, normal use unaffected, lock-out and recovery.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0026](0026-security-defaults.md), [ADR-0029](0029-process-topology.md), the
  [rate limit reference](../reference/rate-limits.md).
