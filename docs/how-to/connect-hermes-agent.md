# Connect a Hermes agent in 5 minutes

This guide connects one agent of a multi-agent system such as Hermes to The Worldbuilder over
MCP. Nothing in it is specific to Hermes: any agent that speaks MCP over Streamable HTTP or
stdio connects the same way. The decisions behind it are in
[ADR-0037](../adr/0037-hermes-agents-as-mcp-clients.md).

::: warning Status
The contracts are fixed (the MCP tools, the token rules, the registry format). The service,
the `worldbuilder` command line and the `/mcp` endpoint are **available from M1**; steps that
need them are marked. Until then this page is the specification the M1 end-to-end test agent
follows.
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

## 2. Register the agent (available from M1)

Start the Worldbuilder service, then register the agent under the name it should carry on the
board. Its proposals will show `agent:<name>`.

```sh
worldbuilder agent add planner --target local_model
```

The command prints a token **once**. Store it in a file only you can read, and never put it on
a command line or in a repository:

```sh
umask 077
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/worldbuilder"
# paste the printed token into this file
"${EDITOR:-vi}" "${XDG_CONFIG_HOME:-$HOME/.config}/worldbuilder/planner.token"
```

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
the URL and the `Authorization: Bearer <token>` header.

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

The bridge never opens your stores and fails with a clear error if the service is not
running.

## 4. Check the connection (available from M1)

Ask the agent to call `world_list` (no arguments). It returns the worlds of your store. If it
fails:

| Symptom | Cause |
| --- | --- |
| 401 or "unauthorized" | token missing, mistyped or revoked; register again |
| request rejected for its host or origin | the client is not talking to `127.0.0.1` or sends a browser origin ([ADR-0029](../adr/0029-process-topology.md)) |
| cards listed only by id and reason | the gate denied them for this agent's target class; adjust your gate rules if you want to allow them ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)) |
| `confirmationRequired` with a `transferId` | the agent is registered as `cloud_model`; confirm the transfer on the board, then let the agent call again with the `transferId` |

## 5. Make the first proposal (available from M1)

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

## 6. Follow your decisions

The agent learns what happened to its proposals by polling `proposal_list` with the cursor of
its previous call:

```json
{ "changedSince": "<nextCursor of the previous proposal_list call>" }
```

Poll every few seconds at most (the board itself polls every 2 seconds,
[ADR-0032](../adr/0032-m1-proposal-polling.md)). A later release adds live notifications over
the same connection; polling with `changedSince` keeps working for catch-up.

## What an agent cannot do

- read or change your stances;
- accept or reject proposals, save a Lage or a decision;
- register, change or remove agent connections;
- release a card for sharing, or share anything with other people;
- receive card content as a `cloud_model` agent without your confirmation of that transfer.

## Hermes' own knowledge

If you want cards or findings that a Hermes installation keeps to show up in The Worldbuilder,
that is a storage adapter or a source connector, not an MCP connection
([ADR-0037](../adr/0037-hermes-agents-as-mcp-clients.md)). It is planned once the storage
details are known.
