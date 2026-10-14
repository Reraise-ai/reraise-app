# Connect a Hermes agent in 5 minutes

This guide connects one agent of a multi-agent system such as Hermes to The Worldbuilder over
MCP. Nothing in it is specific to Hermes: any agent that speaks MCP over Streamable HTTP or
stdio connects the same way. The decisions behind it are in
[ADR-0037](../adr/0037-hermes-agents-as-mcp-clients.md).

::: tip Status
Available now: the service (`worldbuilder serve`), the agent registry (`worldbuilder agent`),
the `/mcp` endpoint and the stdio bridge (`worldbuilder mcp --stdio`). Every step below is
covered by an automated test that follows it with the official MCP client
(`services/api/src/mcp.test.ts`, `services/api/src/mcp-bridge.test.ts`). Nothing here has run in
CI yet.
:::

## What you get

Your agent can see worlds and Lagen (boards), read gate-cleared cards and context packages,
check the rules, and propose moves: place or move a card, draw an edge, create a card, or
comment. **Every move is a proposal.** Nothing counts until you accept it on the board
([ADR-0011](../adr/0011-agent-moves-are-proposals.md)). Your agent never sees your stances and
never shares anything with other people
([ADR-0036](../adr/0036-conclusions-are-private.md)).

## 1. Choose the target class

Register every agent on its own. The target class says where the content your agent reads may
end up, not where the agent process runs.

| The agent uses ... | Register as | What it receives |
| --- | --- | --- |
| only models that run on your device or your own infrastructure | `local_model` | cards your gate rules allow for `local_model` |
| any hosted model (an API in the cloud), even occasionally | `cloud_model` | card content only after you confirmed each transfer on the board |

If one Hermes agent uses a local model and another a hosted one, register the first as
`local_model` and the second as `cloud_model`. When in doubt, choose `cloud_model`.

## 2. Register the agent

Start the Worldbuilder service (`worldbuilder serve --store <your store>`, see the Quickstart in the
repository README), then register the
agent under the name it should carry on the board. Its proposals will show `agent:<name>`.

```sh
umask 077
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/worldbuilder"
worldbuilder agent add planner --target local_model \
  --token-file "${XDG_CONFIG_HOME:-$HOME/.config}/worldbuilder/planner.token"
```

With `--token-file` the token goes straight into a file only you can read and is not printed.
Without it the command prints the token **once**; then paste it into such a file yourself. Never
put a token on a command line or in a repository. If the service runs with a state directory of
its own (`--state`), pass the same `--state` to `agent add`.

The service keeps only a hash of the token, in `agents.yaml` in its state directory
([ADR-0030](../adr/0030-local-state-on-the-device.md)). `worldbuilder agent list` shows the
registered agents; `worldbuilder agent remove planner` revokes one.

## 3. Configure the MCP client

The service listens on `127.0.0.1:4310` by default and serves MCP at `/mcp`
([ADR-0029](../adr/0029-process-topology.md)). Pick the transport your agent supports.

### Streamable HTTP

Most MCP clients take a configuration like this. Let the client read the token from the
environment variable `WORLDBUILDER_AGENT_TOKEN` (set it from the token file in the agent's
start script) rather than writing the token into the configuration file:

```json
{
  "mcpServers": {
    "worldbuilder": {
      "type": "http",
      "url": "http://127.0.0.1:4310/mcp",
      "headers": {
        "Authorization": "Bearer ${WORLDBUILDER_AGENT_TOKEN}"
      }
    }
  }
}
```

The key names (`type`, `url`, `headers`) differ slightly between clients; the essentials are
the URL and the `Authorization: Bearer <token>` header. The service accepts `Host` and `Origin`
values of its own address only: a client must talk to `127.0.0.1` (or the host you started the
service with), and a browser page cannot call `/mcp` unless you allowed its origin with
`--allow-origin`.

### stdio (through the bridge)

If the agent only speaks MCP over stdio, it starts the stateless bridge, which forwards to the
running service. The bridge reads the token from `WORLDBUILDER_AGENT_TOKEN` or from the file
named in `WORLDBUILDER_AGENT_TOKEN_FILE`:

```json
{
  "mcpServers": {
    "worldbuilder": {
      "command": "worldbuilder",
      "args": ["mcp", "--stdio"],
      "env": {
        "WORLDBUILDER_AGENT_TOKEN_FILE": "/path/to/your/config/worldbuilder/planner.token"
      }
    }
  }
}
```

The bridge never opens your stores, never writes a file and fails with a clear error if the
service is not running. It talks to `http://127.0.0.1:4310` unless you set `WORLDBUILDER_URL`
(or pass `--url`) to where `worldbuilder serve` listens. The token is never a command-line
argument: the bridge refuses `--token`. Plain `http://` works for this machine only; for a
service on another host the URL must be `https://`. If the service forgot the session (idle for
30 minutes, restarted), the bridge opens a new one by itself and repeats the call; if that fails
it prints "session expired" and exits non-zero, so the host can restart it.

## 4. Check the connection

Ask the agent to call `world_list` (no arguments). It returns the worlds of your store, as far
as your gate rules let this agent's target class see them. A fresh installation allows every
card for `local_model`, including private cards, and none for `cloud_model` until you add an
`allow` rule in `gate-rules.yaml` of the state directory
([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)). Stance stays on the screen. If it fails:

| Symptom | Cause |
| --- | --- |
| 401 or "unauthorized" | token missing, mistyped or revoked; register again |
| 403 with "Host header is not allowed" or "Origin header is not allowed" | the client is not talking to the address the service listens on, or it sends a browser origin; see the note under the HTTP configuration |
| cards listed only by id and reason | the gate denied them for this agent's target class; adjust your gate rules if you want to allow them ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)) |
| `confirmationRequired` with a `transferId` | the agent is registered as `cloud_model`; confirm the transfer on the board, then let the agent call again with the `transferId` |

## 5. Make the first proposal

Let the agent read the board and comment on it. Tool arguments, as JSON:

```json
{ "lageId": "01M1F21G80R816A1T0V2P6RACH" }
```

for `lage_get`, then for `proposal_create`:

```json
{
  "kind": "comment",
  "payload": {
    "lageId": "01M1F21G80R816A1T0V2P6RACH",
    "text": "The insurer bulletin and the wire report share one origin; worth a second source."
  },
  "rationale": "Brainstorming on the open Lage."
}
```

The proposal appears on your board within a few seconds. Accept or reject it there; only you
can.

## The tools

The agent sees thirteen tools, nothing else is exposed
([ADR-0016](../adr/0016-mcp-first-and-openapi-contracts.md),
[ADR-0039](../adr/0039-knowledge-loop-receipts.md)).

| Tool | Writes? | What it does |
| --- | --- | --- |
| `world_list`, `lage_get`, `cards_search`, `card_get` | no | see worlds and boards, read cards the gate clears |
| `context_package_get` | no | gate-cleared cards with provenance, pending proposals by id and kind only |
| `rules_evaluate` | no | which of your rules fire, without a percentage |
| `proposal_list` | no | proposals and their status, with `changedSince` polling |
| `knowledge_consult` | receipt only | the context package for a task plus a Knowledge Receipt; call it first in every task |
| `memory_route` | no | classify a memory item: card proposal or ephemeral ops fact |
| `proposal_create`, `knowledge_write_back`, `decision_record`, `decision_outcome` | proposals | the only write paths; each makes a pending proposal for you to accept |

A failed call is a tool error whose text is the problem details (status, title, detail) and
never card content.

## 6. Follow your decisions

The agent learns what happened to its proposals by polling `proposal_list` with the cursor of
its previous call:

```json
{ "changedSince": "<nextCursor of the previous proposal_list call>" }
```

Poll every few seconds at most
([ADR-0032](../adr/0032-m1-proposal-polling.md)). The board follows `GET /events` and uses
`proposal_list` only as catch-up. Agents stay on this poll. This release does not send live
notifications over the MCP connection.

## What an agent cannot do

- read or change your stances;
- accept or reject proposals, save a Lage or a decision;
- register, change or remove agent connections;
- release a card for sharing, or share anything with other people;
- receive card content as a `cloud_model` agent without your confirmation of that transfer.

For a `cloud_model` agent the first `context_package_get` (or `knowledge_consult`) answers
`confirmationRequired` with a `transferId` and no content. You confirm that exact transfer on
the board; the agent then calls again with the `transferId` and receives exactly the confirmed
cards, once.

## Hermes' own knowledge

If you want cards or findings that a Hermes installation keeps to show up in The Worldbuilder,
that is a storage adapter or a source connector, not an MCP connection
([ADR-0037](../adr/0037-hermes-agents-as-mcp-clients.md)). It is planned once the storage
details are known.
