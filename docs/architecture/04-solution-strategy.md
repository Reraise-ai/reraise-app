# 4. Solution strategy

A handful of ideas shape every other section. Each is decided in an ADR; this page only
connects them to the quality goals of [section 1](./01-introduction-goals.md#12-quality-goals).

| # | Strategy | Serves quality goal | Decided in |
| --- | --- | --- | --- |
| S1 | **Contracts first.** JSON Schema 2020-12 is the single source of truth for every domain object. OpenAPI 3.1 and MCP tool definitions reference the same schemas. Every contract ships with valid and invalid synthetic examples and a test. | Replaceability, reviewability | [ADR-0016](../adr/0016-mcp-first-and-openapi-contracts.md), [ADR-0020](../adr/0020-build-order-milestones.md) |
| S2 | **Hexagonal core.** `packages/core` holds the domain model and pure logic (provenance, independence count, rules evaluation, context package assembly) and has no I/O. Everything outside reaches it through four ports: `StorageAdapter`, `SourceConnector`, `ModelConnector`, `DisclosureGate`, plus a local-state interface for device-only state ([ADR-0030](../adr/0030-local-state-on-the-device.md)). | Replaceability, portability | [ADR-0003](../adr/0003-typescript-monorepo-stack.md), [ADR-0005](../adr/0005-universal-adapter-architecture.md) |
| S3 | **Files are the truth, reference-by-URI.** Cards stay in the user's store. Canonical ids are derived deterministically from the store URI, so no mapping state exists outside the files. Indexes are disposable. | Portability, provenance integrity | [ADR-0006](../adr/0006-files-are-the-truth.md), [ADR-0023](../adr/0023-core-domain-model.md) |
| S4 | **Patch, never rewrite.** Adapters write only the canonical fields the product changed and leave every other byte of the store file verbatim. | Provenance integrity, replaceability | [ADR-0023](../adr/0023-core-domain-model.md) |
| S5 | **One gate on every egress path, default deny.** Context packages, MCP responses, model and Jev calls and exports all call `DisclosureGate.decide(card, target)` and serialise canonical objects only after the decision. Stances are structurally outside cards. | Privacy | [ADR-0008](../adr/0008-believed-as-private-stance.md), [ADR-0012](../adr/0012-disclosure-gate.md) |
| S6 | **Proposals as the only agent write path.** Agents create proposals; humans accept them through human-only endpoints. Pending proposals count nowhere. | Provenance integrity, privacy | [ADR-0011](../adr/0011-agent-moves-are-proposals.md), [ADR-0026](../adr/0026-security-defaults.md) |
| S7 | **No verdict anywhere in the model.** Rules evaluation returns fired / not fired with triggering cards, never a score; Level 1 answers are attributed estimates. Source profiles have no aggregate field. | Provenance integrity | [ADR-0013](../adr/0013-rules-panel-replaces-barometer.md), [ADR-0015](../adr/0015-two-thinking-levels.md), [ADR-0018](../adr/0018-multidimensional-source-profile.md) |
| S8 | **Conformance kit instead of trust.** Any `StorageAdapter`, inside or outside this repository, proves itself against `packages/conformance`. | Replaceability, reviewability | [ADR-0005](../adr/0005-universal-adapter-architecture.md) |
| S9 | **Local by default.** One user, one device, loopback binding, token-separated human and agent privileges. Remote use is a deliberate configuration. | Privacy, portability | [ADR-0026](../adr/0026-security-defaults.md) |
| S10 | **Walking skeleton, then slices.** The thinnest real path end to end first (M1), then one vertical slice per pull request. | Reviewability | [ADR-0020](../adr/0020-build-order-milestones.md) |

## What the strategy rules out

- A central database that copies the user's stores (contradicts S3).
- An ingestion pipeline (contradicts the no-intake decision,
  [ADR-0014](../adr/0014-no-ingestion-inbox-of-findings.md)).
- Agent write access other than proposals (contradicts S6).
- Any aggregate score, meter or "recommended option" field (contradicts S7).
- Per-world or per-request privacy flags instead of per-card decisions (contradicts S5).
- Persisting a UI library's internal state instead of the Lage format
  ([ADR-0019](../adr/0019-design-tokens-and-board-canvas.md)).
