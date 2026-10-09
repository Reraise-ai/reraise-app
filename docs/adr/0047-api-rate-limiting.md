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
`too-many-requests`) and a `Retry-After` header, never with card content. The order of the hooks
is fixed: Host and Origin check, then the request limit, then authentication.

1. **Per credential**: the official `@fastify/rate-limit` plugin, registered with `global: false`
   and applied through an explicit `onRequest` hook that runs before authentication, so requests
   without a credential are limited by address before they are rejected as 401. Requests that
   present a credential are keyed by the SHA-256 of it. Default 600 requests per 60 seconds.
   `/health` and CORS preflights are exempt. `/mcp` is covered like every other route.
2. **Failed credentials per address**: after 10 rejected credentials in 60 seconds, every further
   request from that address that fails authentication is answered `429` instead of `401` until
   the window ends. A request with a valid credential still passes (decision of the CTO: tokens
   carry 256 bits, and a misconfigured agent must not lock the board out). Memory is bounded
   (1024 addresses).

Both are configurable (`--rate-limit`, `--auth-failure-limit` of `worldbuilder serve`; the
`rateLimit` service option). The OpenAPI document declares the `429` response on every operation,
and `Retry-After` and the `x-ratelimit-*` headers are exposed to the board's origin (CORS).

### Consequences

- Good, because flooding from a local process is slowed, with no new authentication state, and
  an anonymous or bad-credential flood is counted before any credential is looked at.
- Good, because a bad client cannot lock the human or other agents out.
- Bad, because the lock-out does not slow a correct guess: it changes the answer to wrong guesses
  from 401 to 429 and caps nothing else. Guessing is infeasible because of the token entropy, not
  because of this limit; the limit mainly keeps floods and noisy failures in check and makes
  them visible.
- Bad, because the limits are per process and lost on restart.
- The board does not yet show the 429 problem specially; it is an ordinary failed request.

### Confirmation

`services/api/src/rate-limit.test.ts`: 429 problem with `Retry-After` and contract check, per
credential isolation, `/health` exempt, MCP covered, normal use unaffected, lock-out and recovery.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0026](0026-security-defaults.md), [ADR-0029](0029-process-topology.md), the
  [rate limit reference](../reference/rate-limits.md).
