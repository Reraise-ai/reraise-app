# Adapter interfaces

The four interfaces through which The Worldbuilder reaches stores, sources, models and the
outside world ([ADR-0005](../adr/0005-universal-adapter-architecture.md)). They are TypeScript
types in `packages/core/src/adapters/`, typed against the types generated from the JSON
Schemas ([ADR-0028](../adr/0028-json-schema-contract-conventions.md)). If this page and the
code differ, the code and the schemas win and this page is a bug.

## StorageAdapter

One backend that holds cards, worlds, Lagen and decisions: the reference `markdown-files`
adapter (M1), the owner store's adapter, or any third-party store.

| Member | Contract |
| --- | --- |
| `storeInstanceId` | random UUID of the store, part of every card URI; never a hostname, path or user name |
| `capabilities` | `write`, `search`, and `ids`: `native` (the store keeps the ULID) or `derived` (the id is derived from the URI) |
| `read(id)`, `list(query)`, `search(query)`, `listWorlds()` | return canonical cards that validate against `card.schema.json`, each with its `contentHash` ([ADR-0034](../adr/0034-content-hash.md)) |
| `create(draft, author)` | returns the canonical id; callers never predict it. Rejects drafts that break the provenance rules, carry an id or an author, or put player fields on a non-actor |
| `patch(id, patch, guard?)` | changes only the given canonical fields; every other byte of the stored card stays as it was. Never identity, format, author, hash or stance data. A Lage rewrite archives the previous version |
| `archive(id)`, `versions(id)` | nothing is deleted; history is archived versions ([ADR-0006](../adr/0006-files-are-the-truth.md)) |
| `readLegacyStance?(id)` | read only: stance data a store already holds (believed layer, own assessment), mapped per [ADR-0008](../adr/0008-believed-as-private-stance.md); never written back |

Identity: `buildUri(storeInstanceId, externalId)` gives the one canonical URI of a card,
`deriveCardId(uri)` its derived ULID. Only canonical URIs are accepted
([ADR-0023](../adr/0023-core-domain-model.md)).

Conformance: every adapter runs `describeStorageAdapterConformance` from
`@worldbuilder/conformance` with a harness (`adapter`, `reopen`, `relocate`, `raw`, `seed`).
The kit checks ids across instances and locations, canonical URIs, valid cards, content
hashes, byte-identical patches, legacy defaults and the stance mappings.

## SourceConnector

Reports new findings from a connected source with their provenance; read only
([ADR-0014](../adr/0014-no-ingestion-inbox-of-findings.md)).

| Member | Contract |
| --- | --- |
| `id` | connector id, as in `Finding.connector` |
| `findings(query)` | findings that validate against `finding.schema.json`: a URI and a source or origin system on every one |
| `referenceCard(finding)` | the reference card a pin would create; writes nothing. Pinning is a human action or an agent proposal |

## ModelConnector

A replaceable model or engine: the local rules engine, a local model, a cloud model, or the
Jev connector ([ADR-0015](../adr/0015-two-thinking-levels.md)).

| Member | Contract |
| --- | --- |
| `engine`, `target` | engine name (also the proposal author `agent:<engine>`) and its disclosure target class |
| `decide(request, release?)` | level 1: a typed `Level1Answer`, shown attributed, never as a verdict |
| `ask(pkg, question, release?)` | level 2 support: text plus `ProposalCreate`s; it never writes |

A `cloud_model` connector is called only with the `DisclosureRelease` of one confirmed transfer
and sends nothing but its objects ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)).

## DisclosureGate

Decides per card and per target what may leave the screen
([ADR-0012](../adr/0012-disclosure-gate.md),
[ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)).

| Member | Contract |
| --- | --- |
| `decide(item, target)` | default deny; a matching deny rule wins; invalid rules deny everything; stance data only for `screen`; never allows `cloud_model` |
| `preview(input)` | a cloud transfer: the envelope of gate-cleared objects, its RFC 8785 `payloadHash`, an expiry 5 minutes ahead; requested by the board or by an MCP connection |
| `confirm(input)` | human only, with the previewed hash; issues a single-use token (at least 128 bits, bound to the board session, 5 minutes) for board transfers, none for connection transfers |
| `redeem({ grant, envelope })` | consumes the token or the connection grant once, checks the envelope, and returns exactly the confirmed objects as a `DisclosureRelease` |

Rules are data (`gate-rules.schema.json`); adapter fragments may only deny. Conformance:
`describeDisclosureGateConformance` from `@worldbuilder/conformance`; the reference gate in
`packages/disclosure-gate` passes it.

## LocalStateStore

Device-only state: proposals, stances, the gate decision log and the gate rules, as files in
the per-user state directory ([ADR-0030](../adr/0030-local-state-on-the-device.md)). The
service process is the only writer. The reference implementation is `packages/local-state`.

| Member | Contract |
| --- | --- |
| `createProposal(input, author)` | validates against `proposal.schema.json#/$defs/create`; stores a pending proposal with a new ULID id and `createdAt` |
| `getProposal(id)` / `listProposals(request)` | see cursor semantics below |
| `decideProposal(id, status)` | human only; `accepted` or `rejected`, records `decidedBy: human` and `decidedAt`; a decided proposal gives `conflict`, an unknown id `not_found` |
| `getStance(cardId)` / `listStances()` / `saveStance(cardId, input)` | one file per card; every change appends the previous version to `history` |
| `damagedFiles()` | names of proposal and stance files that are not JSON, fail their schema or whose inner id differs from the file name; they count nowhere and are skipped by listings |
| `appendGateLog(entry)` | one JSON line: `at` (ISO 8601 UTC), `cardId`, `item`, `target`, `decision`, a fixed `reason` code and an optional `ruleId`; never content. Rotates at 10 MB keeping 5 files (configurable) |
| `loadGateRules(fragments?)` | reads `gate-rules.yaml`, validates it and the adapter fragments; see below |

Cursor semantics ([ADR-0032](../adr/0032-m1-proposal-polling.md)): `cursor` and
`changedSince` both mean "changed after this cursor" (the later wins if both are given). A
proposal changes when it is created and again when it is decided. Results are ordered by
change, `nextCursor` is always returned (also for an empty page) and moves over changes that a
`status` or `lageId` filter hid, so polling with the returned cursor never skips or repeats a
change. Change stamps are strictly increasing; if the wall clock steps back they continue one
millisecond after the previous stamp.

Fail-closed loading ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)): a rule
file or fragment that is unreadable, larger than 1 MiB, not valid YAML (aliases, duplicate
keys and several documents are refused), schema-invalid, has duplicate rule ids, or a
fragment that contains an allow rule, uses a reserved source (`user`, `fail-closed`) or
repeats a source, yields `ok: false`, the `reason`, and a deny-everything rule set. A missing
file is valid and means no rules, so default deny applies.

Gate log obligation: the caller maps every decision to a reason code (`default_deny`,
`rule_allow`, `rule_deny`, `stance_screen_only`, `invalid_rules`, `confirmation_required`,
`confirmed_transfer`, `connection_not_registered`) and passes the deciding rule's id as
`ruleId`. Free text is not accepted.

Error codes (`LocalStateError.code`): `invalid` (input or stored file fails its schema, bad
id, bad cursor), `not_found`, `conflict`, `unsafe_state_dir` (the directory is inside a store
root or Git working tree, or one of the state files is a symbolic link).

State directory helpers: `resolveStateDir` (per-OS default or an explicit absolute path; UNC
paths are refused on Windows) and `assertStateDirSafe`, both exported by the package.
