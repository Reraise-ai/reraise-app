---
status: proposed
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0028: JSON Schema contract conventions, fixtures and generated types

## Context and Problem Statement

[ADR-0016](0016-mcp-first-and-openapi-contracts.md) makes JSON Schema 2020-12 in `schemas/`
the single source of truth, with valid and invalid examples and generated TypeScript types.
Several ADRs leave exact shapes to "the schema" (stance weight range, estimate field names,
rule shape, context package layout). The first schema set needs one set of conventions:
identifiers, composition, how examples declare their schema, how the markdown-files examples
are read, and the shapes the ADRs left open. Which conventions do we adopt?

## Decision Drivers

- Contracts are readable by adapter authors in any language ([ADR-0005](0005-universal-adapter-architecture.md)).
- No owner domain or infrastructure in identifiers ([ADR-0022](0022-public-hygiene.md)).
- Every rule an ADR states must be provable by a valid and an invalid example.
- Contract data stays free of test-only fields.
- Minimal: no shape beyond what an ADR or a listed contract needs.

## Considered Options

Schema identifiers:

- A real project domain
- A reserved, never-resolving placeholder domain (chosen)
- Relative ids only

Declaring the schema of an example:

- A `$schema` member inside each instance
- A file-name convention
- An envelope `{ synthetic, schema, description, data }` around the instance (chosen)

## Decision Outcome

Chosen options: "reserved placeholder domain" and "envelope", because the project owns no
domain yet and identifiers must not point at anyone else's, and because an envelope keeps
the contracts free of `$schema` and `synthetic` members that only tests need.

### Identifiers and versioning

- `$id` is `https://worldbuilder.invalid/schemas/v0/<name>.schema.json`. `.invalid` is a
  reserved top-level domain (RFC 2606, RFC 6761): it never resolves and belongs to no one.
  Ids are identifiers, never fetched. When the project owns a domain, a new ADR moves them.
- `v0` is the pre-release contract version. Until `v0.1.0` changes stay in `v0` and each
  needs an ADR; after it, a breaking change creates `v1` ids next to `v0`.
- Every schema compiles under Ajv strict mode. `required` names that a schema declares
  through a `$ref` are listed with `true` in its own `properties`.

### Composition

- `card.schema.json` defines every card field once in `$defs/content` with
  `additionalProperties: false`. `Card` requires identity, `CardDraft` (proposal kind
  `create_card`) forbids identity and `author` ([ADR-0011](0011-agent-moves-are-proposals.md)),
  `Decision` adds the decision constraints. `unevaluatedProperties` is not used: it reports
  every property again when a referenced subschema fails, which hides the real error.
- Shared definitions live in `common.schema.json` (ULID, `wb:` URI, author forms, layer and
  the other enums of [ADR-0023](0023-core-domain-model.md)).
- A Lage board state is `lage.schema.json`, held by a card of type `lage` in its `lage`
  field. A structured rule is `rule.schema.json`, held by a card of type `rule` in its `rule`
  field; the rule id is the card id. `rule` is optional on rule cards, because existing store
  rule cards are prose; only structured rules are evaluated.

### Examples and fixtures

- JSON examples (`examples/<world>/*.json`) and fixtures (`schemas/fixtures/{valid,invalid}`)
  use the envelope `{ "synthetic": true, "schema": "<$id>", "description", "data" }`; invalid
  fixtures add `"expect": { "keyword", "instancePath" }`, the Ajv error they must produce.
- Each example world is a markdown-files store (`worldbuilder-store.yaml` with the
  `storeInstanceId`, cards in `cards/*.md`) plus JSON envelopes. Every card is read into the
  canonical card and validated; every id-like value must name a card, world or object of the
  same world; a context package must carry the canonical cards exactly as the store yields them.
- Rules JSON Schema cannot express run as named cross-checks in `validate:schemas`
  (`training-opt-in`: every card id in a training record opted in; `level1-choice`); an
  invalid fixture may expect one with `"expect": { "check": "<name>" }`.
- Every schema except `common` has at least one valid and one invalid case. `pnpm
  validate:schemas` enforces all of this in CI.
- `synthetic: true` is the repository hygiene marker ([ADR-0022](0022-public-hygiene.md)),
  not a card field. Demo clearance ([ADR-0012](0012-disclosure-gate.md)) comes from gate
  rules, for example on the store configuration's `synthetic` flag.

### Reference card format details

In addition to [ADR-0023](0023-core-domain-model.md) and
[ADR-0027](0027-card-format-mapping-addenda.md), the reference `markdown-files` format:

- writes the decision headings `Situation`, `Trigger`, `Conditions`, `Facts`, `Priorities`,
  `Action`, `Alternatives`, `Exclusions`, `Rationale`, `Cards used`, `Outcome`;
- stores a structured rule as a JSON block under `## Rule`, like the Lage block;
- keeps the store configuration in `worldbuilder-store.yaml` at the store root
  (`store-config.schema.json`).

### Shapes left to the schema by earlier ADRs

| ADR | Fixed here |
| --- | --- |
| [0007](0007-epistemic-layer-field.md) | A context item carries the canonical card; its layer and author are the card's, and a card without a layer is unclassified. Pending proposals appear by id and kind only, so no agent free text reaches a model as context. |
| [0008](0008-believed-as-private-stance.md) | Stance `weight` is an integer 1 (weak) to 3 (strong). |
| [0010](0010-estimative-probability-scale.md) | Estimates are `Prediction` objects: `phrase` (verbatim), `band` (ICD 203 key), `mappedBy` (`human` or `lookup:<table>`, never an agent), `statedProbability` (a fraction, only if the source stated one), `resolution`. |
| [0012](0012-disclosure-gate.md) | `DisclosureDecision` has a `subject` (`card` or `stance`); a cloud allow carries a `DisclosureConfirmation` (`confirmedBy: human`) of one `DisclosureTransfer`. |
| [0013](0013-rules-panel-replaces-barometer.md) | Conditions are `card_on_lage`, `card_field`, `edge` and `stance`. Results list `unmet` and `unknown` conditions by clause and index; `withheld` is 0 for `screen`, and for any other target no returned rule has a stance condition. |
| [0015](0015-two-thinking-levels.md) | `Level1Answer` adds `question` and `answeredAt`; `choice` is one of `options`; `Level1Request` is the connector input. |
| [0016](0016-mcp-first-and-openapi-contracts.md) | Request objects (`ContextPackageRequest`, `RulesEvaluateRequest`, `ProposalCreate`) take no target and no author: both come from the caller's registered connection. |
| [0017](0017-decision-card-and-training-export.md) | A training record names no card that did not opt in, not even by id: the decision lists in `cardsUsed` only opted-in cards, and a trace whose decision would keep no used card is not exported, because `cardsUsed` is never empty. The Lage is exported only if the Lage card itself has `training: true`; its placements and edges are filtered to opted-in cards, and a brainstorm proposal touching any other card is dropped entirely. Decision and Lage cards are exported without their Markdown `body`, which repeats card ids; their structured sections carry the content. |
| [0018](0018-multidimensional-source-profile.md) | Dimension values are in [0, 1]; a value is required when `n` ≥ 1 and forbidden when `n` = 0; `minimumN` is part of the profile. |

### Generated types

`scripts/generate-types.mjs` bundles the schemas and generates
`packages/core/src/generated/contracts.ts` with json-schema-to-typescript. The file is
committed; a test and the CI step `pnpm check:generated` fail when it is out of date. The
types describe shapes only; validation always uses the schemas.

### Consequences

- Good, because every ADR rule now has an executable valid and invalid case.
- Good, because contracts carry no test-only members and no owner identifiers.
- Bad, because the placeholder ids must move once a domain exists (a mechanical change).
- Bad, because generated types are less precise than the schemas (conditional rules are not
  expressible in TypeScript).

### Confirmation

`pnpm validate:schemas` and its tests (`scripts/validate-schemas.test.mjs`), the structural
tests in `scripts/contracts.test.mjs`, and the generated-types test.

## Pros and Cons of the Options

### Real project domain

- Good, because ids could be resolvable later.
- Bad, because the project owns none; using another domain points at someone else.

### Placeholder domain

- Good, because neutral and obviously not resolvable.
- Bad, because one later move.

### Relative ids only

- Good, because no domain at all.
- Bad, because other tools cannot reference the schemas by a stable absolute id.

### `$schema` member in instances

- Good, because self-describing.
- Bad, because every contract would have to allow a member that only examples use.

### File-name convention

- Good, because no extra structure.
- Bad, because JSON examples still need a top-level `synthetic` member for the hygiene check.

### Envelope

- Good, because explicit and keeps the contracts clean.
- Bad, because consumers unwrap `data`.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0016](0016-mcp-first-and-openapi-contracts.md),
  [ADR-0022](0022-public-hygiene.md), [ADR-0023](0023-core-domain-model.md),
  [ADR-0027](0027-card-format-mapping-addenda.md).
