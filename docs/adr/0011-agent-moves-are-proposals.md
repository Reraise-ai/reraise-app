---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0011: Agent moves are proposals; nothing counts until a human accepts

> Refined by [ADR-0039](0039-knowledge-loop-receipts.md): `knowledge_write_back`,
> `decision_record` and `decision_outcome` also create proposals, and a new kind `record_outcome`
> proposes the outcome of a decision card. Every agent write is still a proposal.
> Habit metrics ([ADR-0041](0041-usage-ledger-and-metrics.md)) may report proposed counts as
> labelled telemetry; targets count accepted proposals only.

## Context and Problem Statement

The user's own multi-agent system must be able to act on the board: place
and move cards, draw edges, create cards, brainstorm. "Looking at the
chessboard together." At the same time, AI output must never silently
become the user's knowledge. Concept v1 used "ghost cards" (a card status)
and excluded AI hypotheses from its barometer. The owner accepted the
direction and generalised it: nothing an agent proposed counts until a
human accepted it.

## Decision Drivers

- Agents interact with more than cards: moves, edges, comments.
- Human authority over the world is absolute.
- Proposals must be visible with their author.
- One enforced write path for agents.

## Considered Options

- Ghost status on cards (concept v1)
- Direct agent writes with an undo history
- Separate `Proposal` objects, accepted or rejected by a human (chosen)

## Decision Outcome

Chosen option: "Separate `Proposal` objects", because it covers every kind
of move, keeps the stores free of half-states, and gives one write path to
secure.

- `Proposal` = `{id, author: agent:<name>, kind, payload, status,
  decidedBy, decidedAt}` with `kind ∈ {place_card, move_card, add_edge,
  create_card, comment}` and `status ∈ {pending, accepted, rejected}`.
- The MCP tool `proposal_create` is the only write path for agents
  ([ADR-0016](0016-mcp-first-and-openapi-contracts.md)). Its `author` is
  set by the server from the connection's configured agent identity, never
  taken from the payload.
- Accept and reject are human-only Board API endpoints; agent credentials
  cannot call them. On accept, the change is written through the
  `StorageAdapter`; created cards and edges keep `author` / `by` =
  `agent:<name>`.
- Non-counting rule: pending or rejected proposals do not count anywhere:
  not in rules evaluation, statistics, source profiles, decision cards,
  training export, nor as accepted fact in context packages. A context
  package may list them only in a separate, clearly labelled section.
- Agents can never create or change a stance
  ([ADR-0008](0008-believed-as-private-stance.md)).
- Model answers and level-1 results that propose world changes arrive as
  proposals with `author: agent:<engine-name>` (for example
  `agent:local-rules`).

### Consequences

- Good, because agents can brainstorm freely without polluting the world.
- Good, because the audit trail shows who proposed and who accepted.
- Bad, because every agent action needs a human click; batch accept is a
  later UX concern, still per proposal under the hood.
- Bad, because proposals need their own storage and lifecycle.

### Confirmation

Contract tests: MCP has no other writing tool; accept/reject reject agent
credentials; rules evaluation and training export ignore pending and
rejected proposals (unit tests with mixed fixtures). M1 e2e: an agent
proposes a card, a human accepts, reload shows it persisted.

## Pros and Cons of the Options

### Ghost card status

- Good, because simple for cards.
- Bad, because does not cover moves and edges; ghosts leak into stores
  that have no such status.

### Direct writes with undo

- Good, because fast.
- Bad, because unreviewed content counts until someone notices.

### Proposal objects

- Good, because uniform, auditable, enforceable.
- Bad, because more objects and endpoints.

## More Information

- Supersedes concept v1: card status `ghost` and `GhostMeta`
  (`docs/03-datenmodell.md` §3), events `CardProposed` / `GhostAccepted` /
  `RelationProposed`, MCP tools `propose_cards` and `prediction_log`
  (`docs/04-architektur.md` §6), and the narrower rule "AI hypotheses do
  not count in the barometer".
- Related: [ADR-0013](0013-rules-panel-replaces-barometer.md),
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md),
  [ADR-0017](0017-decision-card-and-training-export.md).
