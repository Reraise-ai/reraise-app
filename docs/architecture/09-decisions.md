# 9. Architecture decisions

All decisions are recorded in the [ADR log](../adr/) in MADR format. This page does not repeat
them. It groups them by the architecture concern they shape, and lists the decisions that are
still open.

## 9.1 Decisions by concern

| Concern | ADRs | Where it shows on these pages |
| --- | --- | --- |
| Process and documentation | [0001](../adr/0001-record-architecture-decisions.md), [0002](../adr/0002-english-repository-language.md), [0020](../adr/0020-build-order-milestones.md), [0025](../adr/0025-engineering-process-and-quality-gates.md) | [Constraints](./02-constraints.md), [solution strategy S10](./04-solution-strategy.md) |
| Stack and licensing | [0003](../adr/0003-typescript-monorepo-stack.md), [0004](../adr/0004-two-tier-licensing.md) | [Building blocks 5.4](./05-building-blocks.md#54-package-dependencies-and-licence-tiers) |
| Integration with other systems | [0005](../adr/0005-universal-adapter-architecture.md), [0014](../adr/0014-no-ingestion-inbox-of-findings.md), [0016](../adr/0016-mcp-first-and-openapi-contracts.md) | [Context](./03-context-scope.md), [building blocks](./05-building-blocks.md) |
| Persistence and identity | [0006](../adr/0006-files-are-the-truth.md), [0023](../adr/0023-core-domain-model.md), [0027](../adr/0027-card-format-mapping-addenda.md) | [Crosscutting 8.4, 8.5](./08-crosscutting.md#84-identity-and-references), [runtime 6.3](./06-runtime.md#63-write-back-patch-to-an-external-store) |
| Epistemics and provenance | [0007](../adr/0007-epistemic-layer-field.md), [0008](../adr/0008-believed-as-private-stance.md), [0009](../adr/0009-mandatory-provenance.md), [0010](../adr/0010-estimative-probability-scale.md) | [Crosscutting 8.1, 8.2](./08-crosscutting.md#81-domain-model) |
| Agents and decisions | [0011](../adr/0011-agent-moves-are-proposals.md), [0013](../adr/0013-rules-panel-replaces-barometer.md), [0015](../adr/0015-two-thinking-levels.md), [0017](../adr/0017-decision-card-and-training-export.md), [0018](../adr/0018-multidimensional-source-profile.md) | [Runtime 6.1, 6.2](./06-runtime.md), [crosscutting 8.6, 8.9](./08-crosscutting.md#86-agents-and-proposals) |
| Privacy and security | [0012](../adr/0012-disclosure-gate.md), [0021](../adr/0021-privacy-and-sharing-model.md), [0022](../adr/0022-public-hygiene.md), [0026](../adr/0026-security-defaults.md) | [Crosscutting 8.3, 8.7](./08-crosscutting.md#83-privacy-and-the-disclosure-gate), [deployment](./07-deployment.md) |
| Local runtime: process layout, local state, gate rules, proposal polling, derived index | [0029](../adr/0029-process-topology.md), [0030](../adr/0030-local-state-on-the-device.md), [0031](../adr/0031-gate-rules-and-confirmation-binding.md), [0032](../adr/0032-m1-proposal-polling.md), [0033](../adr/0033-derived-index-reference-adapter.md) | [Building blocks](./05-building-blocks.md), [runtime](./06-runtime.md), [deployment](./07-deployment.md), [crosscutting 8.3](./08-crosscutting.md#83-privacy-and-the-disclosure-gate) |
| User interface | [0019](../adr/0019-design-tokens-and-board-canvas.md) | [Crosscutting 8.10](./08-crosscutting.md#810-user-interface-theming) |
| History of the concept | [0024](../adr/0024-concept-v1-reconciliation.md) | [Concept v1 notes](../product/concept-v1-notes.md) |

## 9.2 Open decisions

Seven questions came up while this documentation was written (OD-1 to OD-7). Five are now
decided by ADRs; two remain owner questions.

### Resolved

| ID | Question | Decision |
| --- | --- | --- |
| OD-1 | Process layout of the Board API and the MCP server, given one write path per store ([ADR-0006](../adr/0006-files-are-the-truth.md)) | One local service process hosts the Board API and the MCP server over Streamable HTTP at `/mcp`; stdio-only clients use the stateless bridge `worldbuilder mcp --stdio` ([ADR-0029](../adr/0029-process-topology.md)) |
| OD-2 | Where proposals, stances, the gate log and gate rules are stored, and who owns them | Files in the per-user OS state directory (never inside a store or Git working tree), owned by `packages/local-state` behind a core interface; `services/api` is the only writer; human-only `PUT /cards/{id}/stance` ([ADR-0030](../adr/0030-local-state-on-the-device.md)) |
| OD-3 | Gate rule language and binding of a cloud confirmation to the cards shown | Declarative YAML allow and deny rules per target over canonical card fields, deny wins, default deny; transfer record and single-use, session-bound token over the SHA-256 of the whole canonical envelope, valid 5 minutes ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)) |
| OD-5 | How the M1 board learns about new proposals | Polls `proposal_list` with `changedSince=<cursor>` every 2 seconds, on MCP and HTTP alike; the M2 live channel replaces polling ([ADR-0032](../adr/0032-m1-proposal-polling.md)) |
| OD-6 | Derived-index technology of the reference adapter | In memory, rebuilt from the files at start, refreshed by a file watcher with rescan fallback; SQLite only on measured need ([ADR-0033](../adr/0033-derived-index-reference-adapter.md)) |

### Still open

| ID | Question | Working assumption | Decided by | Needed before |
| --- | --- | --- | --- | --- |
| OD-4 | The Jev request and response interface. | Stub with the documented shape `POST /v1/decide`, output schema plus state, typed answer with confidence. | Owner | Jev connector slice (M2+) |
| OD-7 | Whether the owner's word "conclusions" means stance data only. | Stance data only, as recorded in [ADR-0021](../adr/0021-privacy-and-sharing-model.md) and [ADR-0012](../adr/0012-disclosure-gate.md). | Owner confirmation | before sharing work (later) |
