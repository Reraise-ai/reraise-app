---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0028: JSON Schema contract conventions, fixtures and generated types

> Amended by [ADR-0035](0035-level1-engine-socket.md) (`level1-prediction` replaces
> `level1-answer`; cross-checks `level1-move` and `level1-players` replace `level1-choice`) and
> [ADR-0036](0036-conclusions-are-private.md) (target `share`, `PackageTarget` for context
> packages and rule evaluations).
>
> Extended by [ADR-0039](0039-knowledge-loop-receipts.md) to
> [ADR-0043](0043-digest-atlas-regeneration.md): knowledge-loop schemas and the cross-checks
> `receipt-hash` and `digest-lines`; agent drafts carry `training` only as `false`.

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
- A fixture may name a definition inside a schema as `<$id>#/$defs/<name>`.
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
- Every card an adapter returns carries `contentHash` (`sha256:<hex>`,
  [ADR-0034](0034-content-hash.md)); drafts may omit it, the store recomputes it.
- Cards have optional, unique free `tags`. They are not a card format v2 field and do not make
  a card format 2; disclosure-gate rules may match them ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)).

### Examples and fixtures

- JSON examples (`examples/<world>/*.json`) and fixtures (`schemas/fixtures/{valid,invalid}`)
  use the envelope `{ "synthetic": true, "schema": "<$id>", "description", "data" }`; invalid
  fixtures add `"expect": { "keyword", "instancePath" }`, the Ajv error they must produce.
- Each example world is a markdown-files store (`worldbuilder-store.yaml` with the
  `storeInstanceId`, cards in `cards/*.md`) plus JSON envelopes. Every card is read into the
  canonical card and validated; every id-like value must name a card, world or object of the
  same world; a context package must carry the canonical cards exactly as the store yields them.
- Rules JSON Schema cannot express run as named cross-checks in `validate:schemas`
  (`training-opt-in`: every card id in a training record opted in; `level1-choice`;
  `content-hash`: every card in an envelope carries the hash of its content;
  `transfer-items`); an
  invalid fixture may expect one with `"expect": { "check": "<name>" }`.
- Every schema except `common` has at least one valid and one invalid case. `pnpm
  validate:schemas` enforces all of this in CI.
- `synthetic: true` is the repository hygiene marker ([ADR-0022](0022-public-hygiene.md)),
  not a card field. Demo clearance ([ADR-0012](0012-disclosure-gate.md)) comes from gate
  rules: an allow rule for target `demo` may match every card of a store whose configuration
  (`store-config.schema.json`) says `synthetic: true`. Without such a rule, demo stays
  default deny.

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
| [0012](0012-disclosure-gate.md) | `DisclosureDecision` has a `subject` (`card` or `stance`) and names its deciding `ruleId`; a logged cloud release carries a `DisclosureConfirmationRef` (never the token) of one `DisclosureTransfer`. |
| [0013](0013-rules-panel-replaces-barometer.md) | Conditions are `card_on_lage`, `card_field`, `edge` and `stance`. Results list `unmet` and `unknown` conditions by clause and index; `withheld` is 0 for `screen`, and for any other target no returned rule has a stance condition. |
| [0015](0015-two-thinking-levels.md) | `Level1Answer` adds `question` and `answeredAt`; `choice` is one of `options`; `Level1Request` is the connector input. |
| [0016](0016-mcp-first-and-openapi-contracts.md) | Request objects (`ContextPackageRequest`, `RulesEvaluateRequest`, `ProposalCreate`) take no target and no author: both come from the caller's registered connection. |
| [0017](0017-decision-card-and-training-export.md) | Resolves the conflict between "cards that did not opt in are omitted, not even as ids" and "`cardsUsed` is never empty" (CTO decision): a training record's decision lists in `cardsUsed` only opted-in cards, and a trace whose decision would keep no used card is not exported. |
| [0018](0018-multidimensional-source-profile.md) | Dimension values are in [0, 1]; a value is required when `n` ≥ 1 and forbidden when `n` = 0; `minimumN` is part of the profile. |

### Board API, MCP tools and adapter interfaces

- `api.schema.json` holds the tool inputs and outputs that are not domain objects (requests,
  pages, the RFC 9457 error). `finding.schema.json` is the `SourceConnector` result
  ([ADR-0014](0014-no-ingestion-inbox-of-findings.md)); `decision.schema.json#/$defs/draft`
  is the body of the human-only decision create operation.
- `schemas/openapi/board-api.yaml` (OpenAPI 3.1) references the JSON Schemas by relative
  path. Each operation that mirrors an MCP tool has the tool name as `operationId`; a query
  or path parameter references the property of the tool's input schema
  (`…Request/properties/<name>`), a body references the input schema itself. A parity test
  in `packages/mcp-server` proves this for every tool.
- Security schemes ([ADR-0026](0026-security-defaults.md)): `sessionToken` (header
  `X-Worldbuilder-Session`, the board's random session token) and `agentToken` (bearer token
  of one registered agent connection). Mirrored operations accept both, except
  `proposal_create`, which accepts only `agentToken`: humans act directly, proposals are the
  agents' path (CTO decision). Operations marked `x-human-only: true` accept only
  `sessionToken` and answer 403 to agent tokens: proposal accept and reject, Lage create
  (`POST /lagen`, body `LageCreateRequest`) and save, decision create and save, the
  disclosure transfer preview, view and confirm, and the user's own stance (`GET` and
  `PUT /cards/{cardId}/stance`, body `StanceInput` = position, weight and note; the server
  sets `updatedAt` and the history; target screen only). No MCP tool reads or writes stances.
  Every operation with a request body answers 413 above the size limit.
- `proposal_list` supports polling ([ADR-0032](0032-m1-proposal-polling.md)), on MCP and
  HTTP and for both token kinds: the request takes `changedSince` (an opaque cursor) and the
  page returns `nextCursor`, to pass as `cursor` for the next page or as `changedSince` for the
  next poll.
- Cloud transfers ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)): `POST /disclosure/transfers` previews a transfer whose envelope
  holds the target, the connector, the request parameters and the gate-cleared canonical
  objects; `payloadHash` is the RFC 8785 SHA-256 of the envelope
  ([ADR-0034](0034-content-hash.md)); the record expires after 5 minutes. The confirm body
  carries the previewed `payloadHash` and the service recomputes the current one; a mismatch
  or a second confirmation is 409, an expired transfer 410.
- Who sends (refines the flow of ADR-0031, CTO decision): a transfer records `requestedBy`.
  - `board`: the confirm response issues the single-use `token` (at least 128 bits, at most
    128 characters, bound to the confirming human session, valid 5 minutes, in memory only).
    The board's send carries `transferId` and `confirmationToken`.
  - `mcp_connection`: an MCP connection registered as `cloud_model` that asks for a context
    package gets `confirmationRequired` with a `transferId` and no content. The human confirms
    that transfer on the board; the confirmation carries no token. The agent calls again with
    the `transferId`, and the service releases the content to that connection only. The
    agent never sees a token.
  - Either way `DisclosureGate.redeem` consumes the grant once, before anything is sent,
    checks the envelope object by object (`contentHash`), and returns exactly the confirmed
    canonical objects (`DisclosureRelease`). `decide` never allows `cloud_model`; cloud
    content leaves only as released objects. Expired transfers and spent grants are pruned.
  - A cloud package without a released transfer has no items, no question and no pending
    proposals, only `denied` ids and reasons; with one, its `transfer` is the
    `DisclosureConfirmationRef` and every item is in its `cardIds` (cross-check
    `transfer-items`). Gate decisions and packages never hold the token.
- `gate-rules.schema.json` describes the user's rule file: allow and deny rules per target
  matching `visibility`, `class`, `collection`, `worlds` (by name or id), `type`, `tags`, card
  `ids` or a synthetic store; an empty `match` matches every card; unknown keys and effects are
  invalid; deny wins, no rule matches stance data. `#/$defs/fragment` describes adapter
  fragments: deny rules only. The reference gate validates the rule file and every fragment
  against the schema and fails closed: any invalid rule, or a fragment with an allow rule,
  denies everything with a reason. `syntheticStore` is an extension of the field list of
  ADR-0031 for demo clearance, decided here.
- Rule conditions may also test a card's `tags` (condition kind `tag`).
- MCP tools (`packages/mcp-server/src/tools.ts`) reference the schemas by `$id`; the MCP
  annotation `readOnlyHint` is false only for `proposal_create`. `context_package_get` keeps
  `readOnlyHint: true`: it never changes the world, it only creates or consumes a disclosure
  transfer.
- The adapter interfaces live in `packages/core/src/adapters/` and are documented in
  `docs/reference/adapters.md`; `packages/conformance` provides
  `describeStorageAdapterConformance` and `describeDisclosureGateConformance`. A `CardPatch`
  never carries `author`. `buildUri`, `parseUri` and `deriveCardId` in `packages/core`
  implement the identity rules of [ADR-0023](0023-core-domain-model.md) and accept only the
  canonical URI that `buildUri` produces.
- `packages/core` exports the JSON Schemas as `SCHEMAS` (generated with the types), so the
  gate and the conformance kit validate with the same files; the scripts import identity and
  hashing from `packages/core` instead of keeping a copy.

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
