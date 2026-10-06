# Reference

Reference pages are information-oriented: precise descriptions to look things up in.

## What exists

| Page | Status |
| --- | --- |
| [Card format v2](./card-format.md) | written. Human-readable specification of the Markdown and YAML card format. |
| [Glossary](../glossary.md) | written. German and English domain terms, field names and value mappings. |
| [Schemas](https://github.com/Reraise-ai/reraise-app/tree/main/schemas) | in progress in M0 (JSON Schema for Card, World, Lage, Edge, Stance, Decision, SourceProfile, ContextPackage; OpenAPI 3.1 for the Board API). Normative: if a schema and a page here differ, the schema wins. |
| [ADR log](../adr/README.md) | written. Every binding decision, in MADR format. |

## Planned

| Page | Planned for |
| --- | --- |
| Adapter interfaces: `StorageAdapter`, `SourceConnector`, `ModelConnector`, `DisclosureGate` | M0 (as TypeScript in `packages/core`), documented here |
| Board API (rendered from the OpenAPI document) | M0 contract, rendered with M1 |
| MCP tools: `world_list`, `lage_get`, `cards_search`, `card_get`, `context_package_get`, `rules_evaluate`, `proposal_create`, `proposal_list` | M0 contract, M1 implementation |
| Conformance kit | M1 |
| Configuration and command line | M1 |
