# Knowledge loop contracts

How agents consult the user's knowledge, write back what they learned, and how that is checked
and measured. The schemas in `schemas/` are normative; this page summarises them. Decisions:
[ADR-0039](../adr/0039-knowledge-loop-receipts.md) to
[ADR-0043](../adr/0043-digest-atlas-regeneration.md). Why it exists:
[Why receipts, not reminders](../explanation/receipts-not-reminders.md).

## The loop for one task

1. `knowledge_consult` at the start: context package plus Knowledge Receipt.
2. The task.
3. `knowledge_write_back` at the end: a proposed card, or a coded "not needed", plus a
   Write-back Receipt.
4. The hand-off (task record) cites both receipts by `receiptId` and `hash`.
5. A reviewer agent or CI runs [`wb receipts verify`](./wb-cli.md#wb-receipts-verify).

## MCP tools and Board API operations

| MCP tool | HTTP | Caller | Input schema | Output schema |
| --- | --- | --- | --- | --- |
| `knowledge_consult` | `POST /knowledge/consult` | agent token | `knowledge-receipt.schema.json#/$defs/consultRequest` | `knowledge-receipt.schema.json#/$defs/consultResult` |
| `knowledge_write_back` | `POST /knowledge/write-back` | agent token | `write-back-receipt.schema.json#/$defs/request` | `write-back-receipt.schema.json#/$defs/result` |
| `decision_record` | `POST /proposals/decision` | agent token | `api.schema.json#/$defs/decisionRecordRequest` | `proposal.schema.json` |
| `decision_outcome` | `POST /proposals/outcome` | agent token | `api.schema.json#/$defs/decisionOutcomeRequest` | `proposal.schema.json` |
| `memory_route` | `POST /memory/route` | agent or session token | `memory-route.schema.json#/$defs/request` | `memory-route.schema.json` |
| (none) | `GET /metrics/usage` | session token only (human) | `api.schema.json#/$defs/usageMetricsRequest` | `usage-metrics.schema.json` |

- The owner's dotted names (`knowledge.consult`, ...) map to the underscore convention of the
  existing tools.
- Agent identity and disclosure target come from the connection, never from input.
- `knowledge_write_back`, `decision_record` and `decision_outcome` create pending proposals and
  are, with `proposal_create`, the only tools with `readOnlyHint: false`. A human accepts or
  rejects every proposal.
- `knowledge_consult` runs exactly the `context_package_get` path through the disclosure gate.
- Agent drafts (`knowledge_write_back`, `decision_record`, `create_card`) cannot set `release`
  other than `private` or `training` other than `false`.

## Knowledge Receipt

`schemas/knowledge-receipt.schema.json`

| Field | Meaning |
| --- | --- |
| `receiptId` | ULID |
| `kind` | `knowledge` |
| `agent` | `agent:<name>` of the connection |
| `taskRef` | the agent system's opaque task reference: 1 to 128 of `A-Z a-z 0-9 . _ : / # -`, no spaces, no `//` (an id, never a title, path or URL) |
| `queryHash` | `hmac-sha256:` keyed hash of the task text with the device key `<state>/receipt-key`; the text is never stored |
| `worldId`, `lageId` | what was consulted |
| `target` | `local_model` or `cloud_model` (the connection's class) |
| `packageId` | id of the returned context package |
| `result` | `cards`, `nothing_found` or `confirmation_required` |
| `cardIds` | the delivered cards (`cards` only; empty otherwise) |
| `transferId` | the cloud transfer to confirm or that was released |
| `at` | time of the consult |
| `hash` | `sha256:` JCS hash of the receipt without `hash` |

## Write-back Receipt

`schemas/write-back-receipt.schema.json`

| Field | Meaning |
| --- | --- |
| `receiptId`, `kind: write_back`, `agent`, `taskRef`, `at`, `hash` | as above |
| `consultReceiptId` | the Knowledge Receipt of the same task, if passed |
| `result` | `proposed` or `not_needed` |
| `proposalId`, `draftHash` | for `proposed`: the pending proposal and the content hash of the draft |
| `reason` | for `not_needed`: `no_new_knowledge`, `already_covered`, `ephemeral_ops_fact` or `task_abandoned` |
| `coveredBy` | for `already_covered`: the card ids that already hold the knowledge |

No receipt field can carry free text, card titles or bodies.

## Receipt log

`<state>/receipt-log.jsonl`, one `ReceiptLogEntry` per line
(`schemas/receipt-log-entry.schema.json`): `{v: 1, seq, at, prev, receipt, hash}`. `prev` of the
first entry is `sha256:` followed by 64 zeros; `hash` is the JCS hash of the entry without
`hash`. Written only by the service, never rotated. Verifier codes and exit codes:
[`wb receipts verify`](./wb-cli.md#wb-receipts-verify).

## Decision proposals

- `decision_record`: a decision draft with the eleven sections, `release` absent or `private`;
  it becomes a `create_card` proposal.
- `decision_outcome`: `{decisionId, outcome, expectedContentHash}`; `outcome` is not `open`. It
  becomes a `record_outcome` proposal. On accept only `sections.outcome` changes, and only if the
  card still has `expectedContentHash`.

## Memory routing

`memory_route` returns `{route, ruleId, signals, classifier: "rules:v3"}`. Rules, first match
wins: `secret`, `personal_data`, `short`, `ops_hint`, `local_reference` → ephemeral;
`public_source` → card; `durable_statement` → card; `transient` → ephemeral; `knowledge_hint` → card;
`default` → ephemeral. Signals and words:
[ADR-0042](../adr/0042-memory-route-classification.md).

## Usage metrics

`schemas/usage-metrics.schema.json`, formulas in
[ADR-0041](../adr/0041-usage-ledger-and-metrics.md). Per agent and window: `tasks`,
`tasksWithReceipts`, `receiptCoverage`, `consults`, `consultsNothingFound`, `writeBacks`,
`writeBacksNotNeeded`, `cardsProposed`, `decisionsProposed`, `outcomesProposed`,
`cardsAccepted`, `cardsRejected`; global `decisions` and `atlas`. Targets (defaults, can be
overridden):

| Target | Default |
| --- | --- |
| `receipt_coverage_7d` | at least 0.8 |
| `agent_cards_7d` | at least 5 accepted agent cards (proposed shown alongside) |
| `atlas_lag_hours` | at most 24 |
| `decisions_with_outcome` | at least 10 |

## Atlas pages

`schemas/digest-page.schema.json`: `pageId`, `title`, `scope`, `target`, `generatedAt`,
`generator`, `lines[]` (`{text, cardIds}`), `sources[]` (`{cardId, contentHash}`). A page is
stale when a source's content hash changed, a source left the scope, or a card entered it. See
[`wb digest`](./wb-cli.md#wb-digest).

## Library

`@worldbuilder/knowledge-loop` exports the pure functions behind all of this
(`createKnowledgeReceipt`, `createWriteBackReceipt`, `checkChain`, `ReceiptLog`,
`verifyReceipts`, `computeUsageMetrics`, `routeMemory`, `buildDigest`, `checkDigestPage`);
`@worldbuilder/training-export` exports `buildTrainingRecord` for the opt-in training export of
[ADR-0017](../adr/0017-decision-card-and-training-export.md).
