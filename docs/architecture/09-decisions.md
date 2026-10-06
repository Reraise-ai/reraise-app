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
| User interface | [0019](../adr/0019-design-tokens-and-board-canvas.md) | [Crosscutting 8.10](./08-crosscutting.md#810-user-interface-theming) |
| History of the concept | [0024](../adr/0024-concept-v1-reconciliation.md) | [Concept v1 notes](../product/concept-v1-notes.md) |

## 9.2 Open decisions

These questions came up while writing this documentation. None is decided here. Each needs
an ADR (or an owner decision) before the milestone named; until then the pages use the
working assumption and say so.

| ID | Question | Working assumption | Decided by | Needed before |
| --- | --- | --- | --- | --- |
| OD-1 | Process layout of the Board API and the MCP server. [ADR-0006](../adr/0006-files-are-the-truth.md) requires one write path per store, but an MCP server over stdio is a separate process started by the agent host. | One local service process hosts the Board API and the MCP Streamable HTTP transport with one core and one adapter instance per store. An MCP server over stdio does not open stores itself; it forwards to that service on loopback with its agent token. | ADR | M1 |
| OD-2 | Where and in which format proposals, stances, the gate decision log and gate rules are stored, and which package owns the local store. [ADR-0008](../adr/0008-believed-as-private-stance.md) fixes only `.worldbuilder/stances/`. | Local files under `.worldbuilder/` on the device, owned by a small Apache-2.0 local-state package that is not a `StorageAdapter` of any shared store. | ADR | M1 |
| OD-3 | Rule language and configuration format of the disclosure gate (which card fields a rule may match, such as `visibility`, `release`, `class`, `synthetic`), and how a per-transfer confirmation is bound to the exact set of cards. | Declarative allow rules over canonical card fields; a confirmation covers one transfer id and the list of card ids and content hashes it showed. | ADR; the owner decides what may go to cloud models | M1 |
| OD-4 | The Jev request and response interface. | Stub with the documented shape `POST /v1/decide`, output schema plus state, typed answer with confidence. | Owner | Jev connector slice (M2+) |
| OD-5 | How the board learns about new proposals before the live channel exists. | M1 lists proposals on load and on explicit refresh; the live channel (SSE) is an M2+ slice. | ADR or M1 pull request | M1 |
| OD-6 | Technology of the derived index in the reference adapter. | In-process, rebuilt from the files at start; no database server. | Adapter pull request, ADR if a new dependency class is added | M1 |
| OD-7 | Whether the owner's word "conclusions" means stance data only. | Stance data only, as recorded in [ADR-0021](../adr/0021-privacy-and-sharing-model.md) and [ADR-0012](../adr/0012-disclosure-gate.md). | Owner confirmation | before sharing work (later) |
