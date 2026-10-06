---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0032: The M1 board polls for proposals; the M2 live channel replaces polling

## Context and Problem Statement

In the M1 walking skeleton a test agent creates a proposal over MCP and a human accepts it on
the board ([ADR-0020](0020-build-order-milestones.md)). The live channel (server-sent events) is
a later vertical slice. How does the M1 board learn that a new proposal exists?

## Decision Drivers

- M1 is the thinnest real path; no infrastructure ahead of its slice.
- The Playwright scenario must see the proposal without a manual reload.
- The later live channel must replace the mechanism without contract churn elsewhere.

## Considered Options

- Manual refresh only
- Polling an incremental proposals endpoint (chosen)
- Build the server-sent events channel already in M1

## Decision Outcome

Chosen option: "Polling an incremental proposals endpoint", because it is simple, testable and
needs nothing the live-channel slice would have to undo.

- The board polls `GET /proposals?since=<cursor>` every 2 seconds while a Lage is open. The
  cursor is opaque and issued by the service; the response contains proposals created or
  changed after it, and the next cursor.
- The endpoint requires the human session token ([ADR-0026](0026-security-defaults.md)) and is
  part of the OpenAPI contract.
- In M2 the "live channel" slice replaces polling with server-sent events for proposals and
  moves; the incremental endpoint stays available for catch-up after a reconnect.

### Consequences

- Good, because M1 needs no streaming infrastructure.
- Good, because the cursor endpoint is reused by the live channel for catch-up.
- Bad, because up to 2 seconds of delay and constant requests while a board is open; acceptable
  on loopback for one user.

### Confirmation

M1 end-to-end test: a proposal created over MCP appears on the board without reload. Contract
test for the cursor semantics (no proposal is missed or repeated across two polls).

## Pros and Cons of the Options

### Manual refresh only

- Good, because nothing to build.
- Bad, because the e2e scenario and the "chessboard together" feeling both suffer.

### Polling with a cursor

- Good, because simple and robust.
- Bad, because latency and idle traffic.

### Server-sent events in M1

- Good, because final behaviour early.
- Bad, because builds a later slice inside the skeleton.

## More Information

- Supersedes concept v1: nothing.
- Resolves open decision OD-5 of the [architecture documentation](../architecture/09-decisions.md).
- Related: [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md),
  [ADR-0020](0020-build-order-milestones.md).
