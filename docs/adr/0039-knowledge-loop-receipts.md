---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0039: The knowledge loop runs on mandatory, checked receipts, not on reminders

## Context and Problem Statement

The Worldbuilder exists so that agents work from the user's knowledge and give back what they
learn. A measured multi-agent installation (anonymised; numbers from its own tool-call logs)
shows that this does not happen by itself:

- the orchestrating agent consulted the knowledge store in 1.4 % of its tool calls; all other
  agents together in 2 of 21,334;
- for days, no agent wrote a single card;
- a nightly memory job wrote 30 to 40 learnings a day into a separate memory database instead of
  the card store;
- the generated atlas (summary pages over the cards) was days out of date;
- the search tool was hidden behind a generic tool search, so agents did not see it;
- reminders before every step ("consult the knowledge first") changed nothing.

The conclusion drawn by the owner: habits come from mandatory, checked fields, not from
reminders. How do agents consult and write back so that it can be checked, without receipts
becoming a second copy of the user's knowledge?

## Decision Drivers

- A task without a consult and without a write-back decision must be detectable by a machine
  (reviewer agent, CI), not by a human reading logs.
- Agents only propose ([ADR-0011](0011-agent-moves-are-proposals.md)); nothing they write counts
  until a human accepts.
- Every egress passes the disclosure gate ([ADR-0012](0012-disclosure-gate.md)); proof of a
  consult must not leak content.
- MCP tool names follow the existing underscore convention ([ADR-0016](0016-mcp-first-and-openapi-contracts.md)).
- Minimal: reuse context packages and proposals instead of new read or write paths.

## Considered Options

- Reminders in prompts and task templates (the measured status quo)
- Server-side usage statistics only (count tool calls, no per-task evidence)
- Receipts: every consult and every write-back decision returns a hashed, logged receipt that
  task hand-offs must cite and a verifier checks (chosen)

## Decision Outcome

Chosen option: "Receipts", because a receipt turns "did the agent consult the knowledge for this
task?" into a yes or no that a program can check against a log the agent cannot write.

### Two receipts per task

- **Knowledge Receipt** (`schemas/knowledge-receipt.schema.json`), returned by
  `knowledge_consult`: `receiptId` (ULID), `kind: knowledge`, `agent` (`agent:<name>` from the
  connection, never from input), `taskRef`, `queryHash`, `worldId`, optional `lageId`,
  `target` (the connection's class), `packageId`, `result` and `cardIds`, optional
  `transferId`, `at`, `hash`.
  - `result` is `cards` (the package delivered at least one card; `cardIds` lists exactly the
    delivered items), `nothing_found` (no card matched; `cardIds` empty) or
    `confirmation_required` (a `cloud_model` connection without a confirmed transfer,
    [ADR-0031](0031-gate-rules-and-confirmation-binding.md); `cardIds` empty, `transferId` set).
    All three prove that the agent consulted.
- **Write-back Receipt** (`schemas/write-back-receipt.schema.json`), returned by
  `knowledge_write_back`: `receiptId`, `kind: write_back`, `agent`, `taskRef`, optional
  `consultReceiptId`, `result` and `at`, `hash`.
  - `result: proposed`: the agent proposed a card; the receipt holds `proposalId` and
    `draftHash` (the content hash of the draft, [ADR-0034](0034-content-hash.md)).
  - `result: not_needed`: the receipt holds a `reason` from a closed list:
    `no_new_knowledge`, `already_covered` (then `coveredBy` lists the card ids that already
    hold it), `ephemeral_ops_fact` (see [ADR-0042](0042-memory-route-classification.md)) or
    `task_abandoned`. There is no free-text reason.
- `taskRef` is an opaque reference chosen by the agent system (for example its task id):
  1 to 128 characters of `A-Z a-z 0-9 . _ : / # -`, no spaces, so it cannot carry prose.
- `queryHash` is `hashJcs(task)` ([ADR-0034](0034-content-hash.md)), the `sha256:` hash of the
  JCS serialisation of the task text. The task text itself is never stored.
- `hash` of a receipt is `hashJcs` of the receipt without its `hash` member.

### Receipts never contain content

A receipt holds ids, hashes, enums and times only: no task text, no query, no card title, no
card body, no free-text reason. This keeps receipts and the receipt log
([ADR-0040](0040-receipt-log-and-verifier.md)) outside the disclosure question: they can be
pasted into hand-offs, kept by reviewer agents and checked in CI without revealing what the user
knows. Card ids are not content: a context package already names denied ids to the same agent
([ADR-0028](0028-json-schema-contract-conventions.md)).

### MCP tools

The owner's names `knowledge.consult`, `knowledge.write_back`, `decision.record`,
`decision.outcome` and `memory.route` map to the underscore convention of
[ADR-0016](0016-mcp-first-and-openapi-contracts.md):

| Tool | Callable by | Effect | `readOnlyHint` |
| --- | --- | --- | --- |
| `knowledge_consult` | agent token only | builds a context package through the same gate path as `context_package_get` and returns it with a Knowledge Receipt | true |
| `knowledge_write_back` | agent token only | either creates a `create_card` proposal, or records "not needed"; returns a Write-back Receipt (and the proposal) | false |
| `decision_record` | agent token only | creates a `create_card` proposal whose card is a decision draft with the eleven sections ([ADR-0017](0017-decision-card-and-training-export.md)) | false |
| `decision_outcome` | agent token only | creates a proposal of the new kind `record_outcome` | false |
| `memory_route` | agent and session token | classifies one memory item, stores nothing ([ADR-0042](0042-memory-route-classification.md)) | true |

- Every Board API mirror has the tool name as `operationId` and the same schemas (parity test).
  The four agent tools accept the agent token only, like `proposal_create`: receipts and
  proposals always belong to one registered agent, and humans act directly.
- `knowledge_consult` keeps `readOnlyHint: true` for the reason `context_package_get` does
  ([ADR-0028](0028-json-schema-contract-conventions.md)): it never changes the world. Appending
  its receipt to the receipt log is audit state on the device, like the gate log.
- Agents may record decisions and outcomes only as proposals; humans accept
  ([ADR-0011](0011-agent-moves-are-proposals.md)). Writing a decision directly stays human-only
  ([ADR-0017](0017-decision-card-and-training-export.md)).
- Every agent write still ends in a proposal. The rule "`proposal_create` is the only write
  path" of ADR-0011 and ADR-0016 is refined to: "every agent write is a proposal; the tools that
  create one are `proposal_create`, `knowledge_write_back`, `decision_record` and
  `decision_outcome`, and they are the only tools with `readOnlyHint: false`".

### New proposal kind `record_outcome`

- Payload `{decisionId, outcome, expectedContentHash}`: `outcome` is non-empty text and not
  `open`; `expectedContentHash` is the content hash of the decision card the agent saw.
- On accept (human-only), the service patches only `sections.outcome` of that decision card,
  and only if its current content hash equals `expectedContentHash`; otherwise the accept fails
  with a conflict and the human sees why.
- This refines "no proposal kind patches a card" of
  [ADR-0036](0036-conclusions-are-private.md): `record_outcome` patches one decision section and
  never `release`, `training`, `visibility` or any other metadata, so the sharing guarantee of
  ADR-0036 is unchanged.
- Like every proposal it counts nowhere until accepted; an accepted outcome closes the loop of
  ADR-0017 (statistics follow in the outcome slice).

### Gate rules for the loop

- `knowledge_consult` is a context package request plus `taskRef` and `task`; it runs exactly
  the `context_package_get` path (gate per card, `cloud_model` only through a confirmed
  transfer, pending proposals by id and kind, never stances) and adds the receipt. There is no
  second read path.
- `knowledge_write_back` and `decision_record` cards are `CardDraft`s with `release` absent or
  `private`, like `create_card` ([ADR-0036](0036-conclusions-are-private.md)); accepted agent
  cards are conclusions and are never shared.
- `task` and memory item texts reach the service as inbound data. They are hashed (consult) or
  classified (memory route) and never logged, stored or sent anywhere.

### Training export (reuse of ADR-0017 and ADR-0028)

The exporter of [ADR-0017](0017-decision-card-and-training-export.md) is implemented in its
home package `packages/training-export` as a pure builder; no contract changes:

- a trace is built only for a decision card with `training: true` and an outcome other than
  `open` (a trace without an outcome teaches no decision style);
- used cards, Lage placements and edges, edges and player entries of used cards, and accepted
  brainstorm proposals keep only opted-in cards; a used card whose `source` or text names a card
  that did not opt in is left out; a trace whose decision text names such a card, or whose
  `cardsUsed` would be empty, is not exported ([ADR-0028](0028-json-schema-contract-conventions.md));
- every record validates against `training-export-record.schema.json` and passes the
  `training-opt-in` cross-check of `validate:schemas`; a test runs that same cross-check over
  the builder's output;
- the export as a whole stays a `cloud_model`-semantics egress with a per-export confirmation
  ([ADR-0012](0012-disclosure-gate.md), [ADR-0031](0031-gate-rules-and-confirmation-binding.md)),
  done by the service, not by the builder.

### Consequences

- Good, because "did the agent use the knowledge?" becomes a checkable field in every hand-off.
- Good, because receipts carry no content, so they can be kept and checked anywhere.
- Good, because no new read or write path exists: consult is a context package, write-back is a
  proposal.
- Bad, because agent systems must thread `taskRef` and two receipts through their task
  templates; the integration package of the agent system does this
  ([ADR-0037](0037-hermes-agents-as-mcp-clients.md)).
- Bad, because a new proposal kind needs board UI (accept dialog showing the outcome) in the
  outcome slice.

### Confirmation

- `pnpm validate:schemas`: valid receipts and requests; invalid receipts with a query text, a
  human agent, `cards` without ids, `nothing_found` with ids, `proposed` without a proposal,
  `already_covered` without `coveredBy`, a free-text reason; the cross-check `receipt-hash`
  rejects a receipt whose hash is not the hash of its content; `record_outcome` with outcome
  `open` is rejected.
- `packages/mcp-server/src/tools.test.ts`: the five tools exist with HTTP mirrors of the same
  schemas; the four agent tools are agent-token only; exactly the four proposal-creating tools
  are not read-only; no tool takes `target`, `author` or `id`.
- `packages/knowledge-loop` tests: receipt creation, hashing and the "no content" rule.
- `packages/training-export` tests: opt-in only, outcome required, stray ids removed, output
  validates and passes the shared cross-check.

## Pros and Cons of the Options

### Reminders

- Good, because no code.
- Bad, because measured to change nothing.

### Usage statistics only

- Good, because no agent changes.
- Bad, because they cannot tell which task skipped the knowledge, and they cannot block a merge.

### Receipts

- Good, because per task, machine-checkable and content-free.
- Bad, because agent templates must carry them.

## More Information

- Supersedes concept v1: nothing.
- Refines [ADR-0011](0011-agent-moves-are-proposals.md) and
  [ADR-0016](0016-mcp-first-and-openapi-contracts.md) (more proposal-creating tools, new kind
  `record_outcome`) and [ADR-0036](0036-conclusions-are-private.md) (one decision section may be
  patched through an accepted proposal).
- Related: [ADR-0040](0040-receipt-log-and-verifier.md),
  [ADR-0041](0041-usage-ledger-and-metrics.md),
  [ADR-0042](0042-memory-route-classification.md),
  [ADR-0043](0043-digest-atlas-regeneration.md),
  [explanation: why receipts, not reminders](../explanation/receipts-not-reminders.md).
