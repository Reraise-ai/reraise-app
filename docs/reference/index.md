# Reference

Reference pages are information-oriented: precise descriptions to look things up in.

## What exists

| Page | Status |
| --- | --- |
| [Card format v2](./card-format.md) | written. Human-readable specification of the Markdown and YAML card format. |
| [Adapter interfaces](./adapters.md) | written. `StorageAdapter`, `SourceConnector`, `ModelConnector`, `DisclosureGate` and their conformance kits. |
| [Knowledge loop contracts](./knowledge-loop.md) | written. Receipts, the receipt log, the knowledge-loop MCP tools, memory routing, usage metrics and atlas pages. |
| [The `wb` command line](./wb-cli.md) | written. `wb receipts verify`, `wb digest`, `wb metrics`, options and exit codes. |
| [Board API rate limits](./rate-limits.md) | written. Per-credential request limit, failed-credential lock-out, 429 problems and the flags that set them. |
| [Glossary](../glossary.md) | written. German and English domain terms, field names and value mappings. |
| [Schemas](https://github.com/Reraise-ai/reraise-app/tree/main/schemas) | written in M0: JSON Schemas for every contract and OpenAPI 3.1 for the Board API ([ADR-0028](../adr/0028-json-schema-contract-conventions.md)). Normative: if a schema and a page here differ, the schema wins. |
| [ADR log](../adr/) | written. Every binding decision, in MADR format. |

## Planned

| Page | Planned for |
| --- | --- |
| Board API (rendered from the OpenAPI document) | M0 contract, rendered with M1 |
| MCP tools: `world_list`, `lage_get`, `cards_search`, `card_get`, `context_package_get`, `rules_evaluate`, `proposal_create`, `proposal_list`, and the knowledge-loop tools | M0 contract, M1 implementation |
| Configuration and command line | M1 |
