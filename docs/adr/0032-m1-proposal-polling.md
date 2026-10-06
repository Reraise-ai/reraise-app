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
- Polling `proposal_list` with a change cursor (chosen)
- Build the server-sent events channel already in M1

## Decision Outcome

Chosen option: "Polling `proposal_list` with a change cursor", because it is simple, testable and
needs nothing the live-channel slice would have to undo.

- Polling uses the existing `proposal_list` operation with an optional parameter
  `changedSince=<opaque cursor>`. The response contains the proposals created or changed after
  the cursor and a `nextCursor`. Without `changedSince` it lists as before and also returns a
  `nextCursor`.
- The parameter exists on the MCP tool `proposal_list` and on its HTTP mirror alike, and both
  token kinds (human session and agent) may use it, so the mirror rule of
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md) holds: there is no board-only listing
  endpoint. Responses pass the disclosure gate for the caller's target as usual.
- The board calls the HTTP mirror every 2 seconds while a Lage is open.
- In M2 the "live channel" slice replaces polling with server-sent events for proposals and
  moves; `proposal_list` with `changedSince` stays available for catch-up after a reconnect.

### Consequences

- Good, because M1 needs no streaming infrastructure.
- Good, because the cursor parameter is reused by the live channel for catch-up.
- Bad, because up to 2 seconds of delay and constant requests while a board is open; acceptable
  on loopback for one user.

### Confirmation

M1 end-to-end test: a proposal created over MCP appears on the board without reload. Contract
tests: `changedSince` and `nextCursor` exist identically on the MCP tool and its HTTP mirror;
no proposal is missed or repeated across two polls; both token kinds can poll.

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
