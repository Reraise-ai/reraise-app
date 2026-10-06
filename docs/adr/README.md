# Architecture Decision Records

This directory is the decision log of The Worldbuilder. Each file records
one decision in [MADR 4.0](https://adr.github.io/madr/) format: context,
considered options, the chosen option with its justification, and the
consequences. Where a decision overrides the earlier German concept
(concept v1), the ADR says so in a "Supersedes concept v1" line;
[ADR-0024](0024-concept-v1-reconciliation.md) lists every concept item and
its fate. References in ADRs to `docs/01-vision.md` through `docs/05-roadmap.md` (the German
concept documents) point to the version at commit `c2b39de`, because those files were removed
from the working tree. See the [concept v1 notes](../product/concept-v1-notes.md).

## How to add an ADR

1. Copy [template.md](template.md) to `NNNN-kebab-case-title.md` using the
   next free number. Numbers are never reused or changed.
2. Fill in all sections, set `status: proposed`, and open a pull request.
3. On approval set `status: accepted` and add a row to the index below.
4. To change an accepted decision, write a new ADR and set the old one to
   `superseded by ADR-NNNN`.

An ADR is required for every change to `schemas/`, the OpenAPI contract,
MCP tool definitions, the adapter interfaces, or the product canon
([ADR-0001](0001-record-architecture-decisions.md)).

## Index

| Number | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as MADR files | accepted | 2026-10-06 |
| [0002](0002-english-repository-language.md) | English as repository language, German terms via a glossary | accepted | 2026-10-06 |
| [0003](0003-typescript-monorepo-stack.md) | TypeScript monorepo with pnpm, Node 22 and a fixed tool chain | accepted | 2026-10-06 |
| [0004](0004-two-tier-licensing.md) | Two-tier licensing (Apache-2.0 and AGPL-3.0-or-later) with DCO | accepted | 2026-10-06 |
| [0005](0005-universal-adapter-architecture.md) | Universal adapter architecture with reference-by-URI | accepted | 2026-10-06 |
| [0006](0006-files-are-the-truth.md) | Files are the truth, indexes are derived | accepted | 2026-10-06 |
| [0007](0007-epistemic-layer-field.md) | Epistemic kind is the field `layer`; `level` is reserved | accepted | 2026-10-06 |
| [0008](0008-believed-as-private-stance.md) | "Believed" is a private stance overlay, never a fourth layer | accepted | 2026-10-06 |
| [0009](0009-mandatory-provenance.md) | Provenance is mandatory; independence counts distinct origins | accepted | 2026-10-06 |
| [0010](0010-estimative-probability-scale.md) | Probability words use the ICD 203 scale; store phrase and band | accepted | 2026-10-06 |
| [0011](0011-agent-moves-are-proposals.md) | Agent moves are proposals; nothing counts until a human accepts | accepted | 2026-10-06 |
| [0012](0012-disclosure-gate.md) | Disclosure gate, default deny, per card and per target | accepted | 2026-10-06 |
| [0013](0013-rules-panel-replaces-barometer.md) | A rules panel replaces the probability barometer | accepted | 2026-10-06 |
| [0014](0014-no-ingestion-inbox-of-findings.md) | No ingestion; the inbox lists new findings from connected sources | accepted | 2026-10-06 |
| [0015](0015-two-thinking-levels.md) | Two thinking levels: fast typed answers and the board | accepted | 2026-10-06 |
| [0016](0016-mcp-first-and-openapi-contracts.md) | MCP-first AI interface and an OpenAPI 3.1 Board API, contract-first | accepted | 2026-10-06 |
| [0017](0017-decision-card-and-training-export.md) | Decision card with eleven sections, outcome loop, opt-in training export | accepted | 2026-10-06 |
| [0018](0018-multidimensional-source-profile.md) | Multi-dimensional source profile, never a single credibility score | accepted | 2026-10-06 |
| [0019](0019-design-tokens-and-board-canvas.md) | Design tokens only until the brand design system lands; canvas on @xyflow/react | accepted | 2026-10-06 |
| [0020](0020-build-order-milestones.md) | Build order: contract-first, walking skeleton, vertical slices | accepted | 2026-10-06 |
| [0021](0021-privacy-and-sharing-model.md) | Privacy and sharing model for the later platform | accepted | 2026-10-06 |
| [0022](0022-public-hygiene.md) | Public hygiene: synthetic data only, no-real-data check, secret scanning | accepted | 2026-10-06 |
| [0023](0023-core-domain-model.md) | Core domain model compatible with the owner's card format v2 | accepted | 2026-10-06 |
| [0024](0024-concept-v1-reconciliation.md) | Reconciliation of concept v1 with the product hand-over | accepted | 2026-10-06 |
| [0025](0025-engineering-process-and-quality-gates.md) | Engineering process and quality gates | accepted | 2026-10-06 |
| [0026](0026-security-defaults.md) | Security defaults for the Board API and the MCP server | accepted | 2026-10-06 |
| [0027](0027-card-format-mapping-addenda.md) | Card format mapping addenda: Lage heading and archive folder | accepted | 2026-10-06 |
