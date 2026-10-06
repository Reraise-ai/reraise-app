# Schemas

The JSON Schemas (2020-12) in this directory are the source of truth for every contract of
The Worldbuilder ([ADR-0016](../docs/adr/0016-mcp-first-and-openapi-contracts.md)). The
conventions are recorded in
[ADR-0028](../docs/adr/0028-json-schema-contract-conventions.md).

## Identifiers

Every schema has the `$id` `https://worldbuilder.invalid/schemas/v0/<file>`. The domain
`worldbuilder.invalid` is a reserved, never-resolving placeholder (RFC 2606): the ids are
names, not addresses, and nothing fetches them. `v0` is the pre-release contract version.

## Schemas

| File                                 | Contract                                                                     | ADR              |
| ------------------------------------ | ---------------------------------------------------------------------------- | ---------------- |
| `common.schema.json`                 | shared definitions: ULID, `wb:` URI, author forms, enums                     | 0023             |
| `card.schema.json`                   | canonical card, card draft, player fields, decision sections                 | 0007, 0009, 0023 |
| `shared-card.schema.json`            | what a share with other people carries: content and provenance only          | 0036             |
| `edge.schema.json`                   | typed card edge                                                              | 0023             |
| `lage.schema.json`                   | board state of a Lage                                                        | 0006, 0023       |
| `decision.schema.json`               | decision card with eleven sections                                           | 0017             |
| `rule.schema.json`                   | structured rule (`when`, `then`, `unless`)                                   | 0013             |
| `rule-evaluation.schema.json`        | `rules_evaluate` result, no percentage, `withheld` count                     | 0013             |
| `stance.schema.json`                 | private stance with history                                                  | 0008             |
| `world.schema.json`                  | world                                                                        | 0021, 0023       |
| `store-config.schema.json`           | per-store configuration (`storeInstanceId`)                                  | 0023             |
| `proposal.schema.json`               | agent proposal, create input, accept/reject body                             | 0011             |
| `source-profile.schema.json`         | eight dimensions, each with `n`                                              | 0018             |
| `prediction.schema.json`             | estimate: phrase and ICD 203 band                                            | 0010             |
| `disclosure-decision.schema.json`    | gate decision, transfer preview and payload hash, confirmation, share bundle | 0012, 0031, 0036 |
| `level1-prediction.schema.json`      | level-1 request and per-player prediction                                    | 0035             |
| `context-package.schema.json`        | context package for a target                                                 | 0012, 0016       |
| `training-export-record.schema.json` | one JSONL decision trace                                                     | 0017             |
| `finding.schema.json`                | a finding of a source connector                                              | 0014             |
| `gate-rules.schema.json`             | disclosure-gate allow and deny rules                                         | 0012, 0031       |
| `knowledge-receipt.schema.json`      | Knowledge Receipt, `knowledge_consult` request and result                    | 0039, 0040       |
| `write-back-receipt.schema.json`     | Write-back Receipt, `knowledge_write_back` request and result                | 0039, 0040       |
| `receipt-log-entry.schema.json`      | one hash-chained line of the receipt log                                     | 0040             |
| `task-record.schema.json`            | a task hand-off citing its receipts                                          | 0040             |
| `usage-metrics.schema.json`          | knowledge-loop metrics per agent and window, targets                         | 0041             |
| `memory-route.schema.json`           | `memory_route` request and result                                            | 0042             |
| `digest-page.schema.json`            | one atlas page with cited lines and source hashes                            | 0043             |
| `api.schema.json`                    | MCP tool and Board API inputs and outputs, error                             | 0016, 0026, 0032 |

The Board API is described in [`openapi/board-api.yaml`](openapi/board-api.yaml) (OpenAPI 3.1,
`pnpm lint:openapi`); it references these schemas. The MCP tools in
`packages/mcp-server/src/tools.ts` use the same schemas, proven by a parity test.

## Fixtures

`fixtures/valid/` and `fixtures/invalid/` hold envelopes
`{ "schema": "<$id>", "description", "data" }` (the schema may name a definition as
`<$id>#/$defs/<name>`); an invalid fixture adds
`"expect": { "keyword", "instancePath" }`, the Ajv error it must produce. The example worlds
in [`examples/`](../examples/README.md) are valid cases too.

```sh
pnpm validate:schemas   # compile strictly, check examples and fixtures
pnpm generate:types     # regenerate packages/core/src/generated/contracts.ts
pnpm check:generated    # fail if the generated types are out of date
```
