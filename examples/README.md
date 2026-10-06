# Example worlds

Synthetic data only ([ADR-0022](../docs/adr/0022-public-hygiene.md)). Every person,
organisation, source and number here is invented; every file is marked `synthetic: true`.

| World     | Content                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hormuz/` | Geopolitics reference scenario of M1: a provenance chain of three findings with one origin, two actors with sourced player fields, an experience card, a legacy format-1 card, two rules (one stance-dependent), a Lage, an open decision, a class-A card that the gate withholds, plus a pending proposal, a context package for a local model, a rule evaluation, a level-1 answer and an estimate. |
| `palma/`  | A personal decision: renting a flat. Three cards (evidenced, said, experience) and a decided decision.                                                                                                                                                                                                                                                                                                |

## Layout

Each world is a store in the reference `markdown-files` format
([card format reference](../docs/reference/card-format.md),
[ADR-0028](../docs/adr/0028-json-schema-contract-conventions.md)):

- `worldbuilder-store.yaml`: the store configuration with its random `storeInstanceId`;
- `cards/*.md`: one card per file, YAML front matter plus Markdown body;
- `*.json`: other contract objects as envelopes
  `{ "synthetic": true, "schema": "<$id>", "description", "data" }`.

`pnpm validate:schemas` reads every card into the canonical model, validates everything
against the schemas and checks that every referenced id exists in the same world.
