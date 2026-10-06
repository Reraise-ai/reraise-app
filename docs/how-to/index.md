# How-to guides

How-to guides are task-oriented: short recipes for a goal you already have.

They follow the code. Each guide is written with the feature it describes and its commands are
checked in CI where possible.

## Available

| Guide | Audience |
| --- | --- |
| [Connect a Hermes agent in 5 minutes](./connect-hermes-agent.md) | agent operators. Any MCP-capable agent; the service parts are available from M1. |

## Planned

| Guide | Planned for | Audience |
| --- | --- | --- |
| Write a storage adapter | M1 | adapter authors. Implement `StorageAdapter` and pass the conformance kit. |
| Run the conformance kit against your adapter | M1 | adapter authors |
| Write a source connector | M2+ | connector authors. Report new findings with provenance, reference then pin. |
| Write a model connector | M2+ | model authors. Answer as a proposal behind the disclosure gate. |
| Write a level-1 engine | after M1 | engine authors. Implement `Level1Engine` and pass `describeLevel1EngineConformance` ([ADR-0035](../adr/0035-level1-engine-socket.md)). |
| Mark a card for the training export | M2+ | everyone. `training: true` per card, opt-in. |
| Add a rule | M2+ | everyone. Write a rule card for the Rules panel. |

Until they exist, the [reference](../reference/index.md) is the source of truth, starting with
the [card format](../reference/card-format.md).
