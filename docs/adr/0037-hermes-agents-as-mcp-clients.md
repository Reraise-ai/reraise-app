---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0037: Hermes agents connect as individually registered MCP clients

## Context and Problem Statement

The first target users run their own agent systems
([ADR-0016](0016-mcp-first-and-openapi-contracts.md), [vision](../product/vision.md)), for
example multi-agent systems such as Hermes. The owner decided on 2026-10-06 that agents of
such a system sit at the board: they read context packages, see the board, brainstorm and
propose moves. Each agent connection is registered on its own as `local_model` or
`cloud_model`, depending on the agent. Where such a system keeps its own knowledge differs
between installations and is not specified yet.

[ADR-0016](0016-mcp-first-and-openapi-contracts.md) makes MCP the AI interface,
[ADR-0029](0029-process-topology.md) serves it at `/mcp` of the local service, and
[ADR-0026](0026-security-defaults.md) and [ADR-0012](0012-disclosure-gate.md) require a bearer
token and a target class per registered connection. Neither says how a connection is
registered, which class an agent gets, or how Hermes' knowledge would enter. What is the
integration architecture?

## Decision Drivers

- Generic: what works for Hermes works for any MCP-capable agent system; no Hermes-specific
  code in the product.
- One identity, one token and one target class per agent, so authorship and disclosure are
  exact.
- Agents only propose ([ADR-0011](0011-agent-moves-are-proposals.md)); they never see stances
  and never share ([ADR-0036](0036-conclusions-are-private.md)).
- "Connect your agent in 5 minutes" for operators of agent systems.
- No owner infrastructure details in the repository ([ADR-0022](0022-public-hygiene.md)).

## Considered Options

- A Hermes-specific adapter package that pushes into the Worldbuilder
- One shared connection for the whole multi-agent system
- Every Hermes agent is a plain MCP client of `/mcp` with its own registered connection;
  Hermes knowledge later through the existing adapter ports (chosen)

## Decision Outcome

Chosen option: "Every Hermes agent is a plain MCP client with its own registered connection",
because it needs no new interface, keeps authorship and the disclosure target exact per agent,
and keeps the product neutral towards any agent system.

### Connection registry

- An agent connection is registered by the human with the `worldbuilder` command line
  (`services/api`, [ADR-0029](0029-process-topology.md)):
  - `worldbuilder agent add <name> --target local_model|cloud_model` creates the connection
    and prints its token once;
  - `worldbuilder agent list` shows name, target class and creation time, never a token;
  - `worldbuilder agent remove <name>` revokes it; the token is rejected from then on.
- The registry is local state: `<state>/agents.yaml`, validated against
  `schemas/agent-connections.schema.json` (this extends the layout of
  [ADR-0030](0030-local-state-on-the-device.md)). It holds `name`, `target`, `tokenHash`
  (`sha256:<hex>`), `createdAt` and `revokedAt`. The token itself is never stored, logged or
  exported. Names are unique; a name must not equal a level-1 engine id, because both act as
  `agent:<name>` ([ADR-0035](0035-level1-engine-socket.md)).
- Tokens: 256 random bits from a secure source, base64url; compared by hash in constant time.
  An unregistered, revoked or wrong token is rejected before any tool runs.
- Registration is human-only: no MCP tool and no agent token can register, change or remove a
  connection.

### Target class per agent

- `local_model` only if every model the agent uses runs under the user's control (on the
  device or on the user's own infrastructure). An agent that sends anything it reads to a
  hosted model is `cloud_model`, even if the agent process itself runs locally. The class is
  about where the content ends up, not where the agent runs.
- A Hermes system with both kinds registers each agent with its own class. A `cloud_model`
  agent receives card content only through a transfer the human confirmed on the board
  (`mcp_connection` flow of [ADR-0028](0028-json-schema-contract-conventions.md)); it never
  sees a confirmation token.

### What an agent can do

| Need | Tool | Rule |
| --- | --- | --- |
| list worlds, see the board | `world_list`, `lage_get` | gate-filtered for the connection's class |
| read cards | `cards_search`, `card_get` | gate-filtered; denied cards only by id and reason |
| read a context package | `context_package_get` | gate-cleared cards with provenance; pending proposals by id and kind only; never stances; `cloud_model` only through a confirmed transfer |
| see what the rules say | `rules_evaluate` | no stance-dependent rule for a model target |
| brainstorm, propose moves | `proposal_create` | the only write path: `place_card`, `move_card`, `add_edge`, `create_card`, `comment`; author `agent:<name>` from the connection; a created card is never released for sharing |
| follow decisions | `proposal_list` with `changedSince` | see below |

Agents never read or write stances, never accept or reject proposals, never save a Lage or a
decision, and nothing they send reaches the `share` target. Card text an agent reads is data,
not instructions; its proposals are reviewed by the human.

### Following the board

- M1: polling. An agent calls `proposal_list` with `changedSince=<nextCursor>` of its last
  call ([ADR-0032](0032-m1-proposal-polling.md)) to learn which of its proposals were accepted
  or rejected and what else was proposed. Agents should not poll more often than every
  2 seconds; a slower interval is fine.
- Later: the live-channel slice adds server-sent notifications over the same Streamable HTTP
  connection (MCP notifications for proposals and Lage changes). `proposal_list` with
  `changedSince` stays for catch-up after a reconnect, so a polling agent keeps working.

### The agent system's own knowledge

Not decided until a concrete installation's storage is known. The integration stays generic:

- If Hermes keeps cards or notes the user wants on the board, an adapter for that store
  implements `StorageAdapter` (read-only is allowed: `capabilities.write = false`) and passes
  the conformance kit ([ADR-0005](0005-universal-adapter-architecture.md)).
- If Hermes produces findings (news, research), an adapter implements `SourceConnector`:
  findings with provenance in the inbox, referenced, pinned only on demand
  ([ADR-0014](0014-no-ingestion-inbox-of-findings.md)).
- Hermes agents do not push their memory into a world over MCP; they propose single cards.
- Such an adapter is built outside the core packages and gets its own ADR once the storage
  details are known. No host name, path or credential of any installation enters the
  repository.

### Documentation and test agent

- `docs/how-to/connect-hermes-agent.md`: a generic MCP client configuration for Streamable
  HTTP and for the stdio bridge, token handling, choosing the target class and a first
  proposal. Parts that need the M1 service are marked "available from M1".
- The bridge and agent configurations read the token from `WORLDBUILDER_AGENT_TOKEN` or from
  the file named in `WORLDBUILDER_AGENT_TOKEN_FILE`, never from a command-line argument
  ([ADR-0029](0029-process-topology.md)).
- The M1 end-to-end test uses a scripted test agent that follows exactly the steps of the
  how-to: registered connection, `lage_get`, `proposal_create`, `proposal_list` polling.

### Consequences

- Good, because any MCP-capable agent system connects the same way; Hermes needs no special
  code.
- Good, because every proposal names the exact agent, and every agent gets exactly the
  disclosure its models justify.
- Bad, because a multi-agent system with many agents means many registrations and tokens; a
  batch registration can come later if needed.
- Bad, because the registry is a new local-state file that `packages/local-state` and the
  service must implement in M1.
- Neutral: where Hermes' knowledge lives remains open; the ports above cover both likely cases.

### Confirmation

- `pnpm validate:schemas`: the registry schema with a valid two-agent registry and invalid
  cases (a token in clear, target `share`, a duplicate name via the cross-check `agent-names`,
  an unprefixed hash).
- M1 integration tests: `/mcp` rejects missing, unknown and revoked tokens; the author of a
  proposal is the registered name; a `cloud_model` connection gets no card content without a
  confirmed transfer; no tool can register or remove a connection.
- M1 end-to-end test: the scripted test agent proposes a card over MCP and the human accepts
  it on the board.

## Pros and Cons of the Options

### Hermes-specific push adapter

- Good, because tailored to one system.
- Bad, because it bypasses proposals and the gate, and ties the product to one agent system.

### One shared connection

- Good, because one token to manage.
- Bad, because authorship is lost and one cloud-using agent would force every agent to
  `cloud_model`, or worse, leak through a `local_model` registration.

### Plain MCP client per agent

- Good, because generic, exact and already covered by the contracts.
- Bad, because more registrations.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0011](0011-agent-moves-are-proposals.md), [ADR-0012](0012-disclosure-gate.md),
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md), [ADR-0026](0026-security-defaults.md),
  [ADR-0029](0029-process-topology.md), [ADR-0030](0030-local-state-on-the-device.md),
  [ADR-0032](0032-m1-proposal-polling.md), [ADR-0036](0036-conclusions-are-private.md).
