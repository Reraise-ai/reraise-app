---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0024: Reconciliation of concept v1 with the product hand-over

## Context and Problem Statement

Concept v1 (German, `docs/01-vision.md` to `docs/05-roadmap.md`, plus the
frozen click prototype) was written before the owner's hand-over and the
owner decisions of 2026-10-05/06. The hand-over wins where they conflict, and
every resolution must be recorded. Many smaller concept items are not
worth an ADR each. This ADR lists every concept v1 decision that the
hand-over touches, with a verdict: kept, changed, deferred or dropped.

## Decision Drivers

- No silent loss of concept decisions.
- One place to look up "what happened to idea X".
- Defer rather than drop where the owner has not ruled.

## Considered Options

- One ADR per concept item
- Rewrite the concept documents in place and drop the history
- One reconciliation ADR that points to topic ADRs (chosen)

## Decision Outcome

Chosen option: "One reconciliation ADR that points to topic ADRs",
because it keeps the log short while still recording every item. The
concept documents move to `docs/product/` (translated) as design
reference; where they disagree with an ADR, the ADR wins.

| # | Concept v1 item (location) | Verdict | Resolution | ADR |
| --- | --- | --- | --- | --- |
| 1 | Append-only SQLite event log as truth (03 §1, §10; 04 §4) | changed | Files are the truth; history = archived versions | [0006](0006-files-are-the-truth.md) |
| 2 | Local SQLite with FTS5, sqlite-vec, embeddings (04 §4) | changed | Allowed only as a derived, rebuildable index | [0006](0006-files-are-the-truth.md) |
| 3 | Time travel by log replay, snapshots with `upToSeq` (03 §9; 04 §4) | changed | Time slider on timestamps and archived Lage versions (M2) | [0006](0006-files-are-the-truth.md) |
| 4 | ULIDs for all ids (03 §1) | kept | Plus `externalId` / `uri` for foreign ids | [0023](0023-core-domain-model.md) |
| 5 | `origin` / `AuthorRef` / `Visibility` (03 §2) | changed | `author`, `originSystem`, `visibility`, `release` | [0023](0023-core-domain-model.md) |
| 6 | Layer derived by `layerOf` (03 §5.1) | changed | Explicit `layer`; `level` reserved | [0007](0007-epistemic-layer-field.md) |
| 7 | Believed as a separate `Stance` object (03 §5.2) | kept | Private overlay, never a layer | [0008](0008-believed-as-private-stance.md) |
| 8 | Stance scale −2..+2 plus confidence 0–100 % (03 §5.2; 05 §4 decision 4) | changed | `position` + `weight` + `note`, history kept | [0008](0008-believed-as-private-stance.md) |
| 9 | Stances shareable on purpose (04 §10.5) | dropped | Stances never leave the device | [0021](0021-privacy-and-sharing-model.md) |
| 10 | Ghost cards via `status: ghost` (03 §3; 02 §7) | changed | Separate `Proposal` objects | [0011](0011-agent-moves-are-proposals.md) |
| 11 | "AI hypotheses do not count" (02 §4) | kept | Generalised: nothing proposed counts until accepted | [0011](0011-agent-moves-are-proposals.md) |
| 12 | Hypothesis cards from game theory and the 36 Stratagems (02 §4, §7) | changed | Thinking tools stay; their output is agent proposals, no special card kind | [0011](0011-agent-moves-are-proposals.md) |
| 13 | Premise barometer with layer weights (02 §4–§5; 03 §6.4) | dropped | Rules panel, no percentage | [0013](0013-rules-panel-replaces-barometer.md) |
| 14 | "N cards · M origins" and origin roots (03 §6) | kept | Counted in `packages/core` | [0009](0009-mandatory-provenance.md) |
| 15 | Prediction cards and German word table (03 §11.1) | changed | Estimates store phrase + ICD 203 band; resolution through the outcome loop | [0010](0010-estimative-probability-scale.md) |
| 16 | `DecisionData` with options, forecasts, review (03 §11.2) | changed | Eleven-section decision card | [0017](0017-decision-card-and-training-export.md) |
| 17 | Review flow, reminders, process-vs-outcome rating (02 §10) | deferred | Outcome-loop slice (M2) | [0017](0017-decision-card-and-training-export.md) |
| 18 | Experience as card type with series "4 of 5" (03 §5.3) | changed | Experience is a `layer`; series counters deferred | [0007](0007-epistemic-layer-field.md) |
| 19 | Rules with when / prefer / unless and statistics (03 §11.3) | kept | Renamed `then`; user-authored data | [0013](0013-rules-panel-replaces-barometer.md) |
| 20 | "What would I do?" recommendation (02 §7) | changed | Fired-rules list; level-1 attributed estimate | [0013](0013-rules-panel-replaces-barometer.md), [0015](0015-two-thinking-levels.md) |
| 21 | Source profile dimensions (03 §12; 02 §8) | changed | Owner's eight dimensions, each with `n` | [0018](0018-multidimensional-source-profile.md) |
| 22 | Eleven relation types (03 §7) | changed | Eight edge kinds of card format v2; contradicts → refutes, derived-from → based_on, actor relations → `relation` | [0023](0023-core-domain-model.md) |
| 23 | Symmetric relations stored once (03 §7) | dropped | Edges are directed and carry `by` | [0023](0023-core-domain-model.md) |
| 24 | Player field `redLines` (03 §4.1) | deferred | Not in card format v2; owner to decide; later ADR | [0009](0009-mandatory-provenance.md) |
| 25 | Unsourced player entries as own assessment (03 §4.1) | changed | `source` required | [0009](0009-mandatory-provenance.md) |
| 26 | World memberships with role, weight, note; premises (03 §8) | deferred | `worlds[]` references now; memberships and premises in the multi-world slice | [0023](0023-core-domain-model.md) |
| 27 | Mandatory guiding question (02 §1) | kept | `Lage.question` required | [0023](0023-core-domain-model.md) |
| 28 | Six phases bar (02 §4) | changed | UX guidance only, not persisted | [0023](0023-core-domain-model.md) |
| 29 | Four lenses with per-lens layouts (02 §5; 03 §9) | changed | One position set per Lage; lenses become computed views per slice | [0023](0023-core-domain-model.md) |
| 30 | "Fremdkörper" tray for misfits, `parked` flag (02 §1, §3) | deferred | Kept as UX reference; added to the Lage contract by ADR in a board slice | [0023](0023-core-domain-model.md) |
| 31 | Ingest pipeline, extraction triage, quick capture (02 §6, §9; 04 §8) | dropped | Inbox of findings, reference-then-pin | [0014](0014-no-ingestion-inbox-of-findings.md) |
| 32 | Cloud or local model for ingest (05 §4 decision 3) | dropped | Obsolete without ingestion | [0014](0014-no-ingestion-inbox-of-findings.md) |
| 33 | `LlmAdapter` / `EmbeddingAdapter`, privacy config (04 §5) | changed | `ModelConnector` behind the disclosure gate | [0005](0005-universal-adapter-architecture.md), [0012](0012-disclosure-gate.md) |
| 34 | Context package with layers, independence, contradictions, budget (04 §7) | kept | Via `context_package_get`; English layer values; no stances; ranking details in the context slice | [0016](0016-mcp-first-and-openapi-contracts.md) |
| 35 | MCP tool names (04 §6) | changed | New tool set; `proposal_create` only write path | [0016](0016-mcp-first-and-openapi-contracts.md) |
| 36 | Agents can never write active content or stances (04 §6.1) | kept | Enforced via proposals and human-only endpoints | [0011](0011-agent-moves-are-proposals.md) |
| 37 | Untrusted source text treated as data, not instructions (04 §8) | kept | Applies to connector findings and agent input | [0014](0014-no-ingestion-inbox-of-findings.md) |
| 38 | Loopback binding, session token, MCP bearer token (04 §11) | kept | Security defaults; agent and human tokens separated | [0026](0026-security-defaults.md) |
| 39 | React Flow instead of tldraw (04 §9) | kept | `@xyflow/react`, custom nodes | [0019](0019-design-tokens-and-board-canvas.md) |
| 40 | Layer colours of the visual grammar (02 §2.1) | changed | Brand tokens | [0019](0019-design-tokens-and-board-canvas.md) |
| 41 | Package split and zod as schema source (04 §3) | changed | New layout; JSON Schema canonical | [0003](0003-typescript-monorepo-stack.md), [0016](0016-mcp-first-and-openapi-contracts.md) |
| 42 | Tauri desktop shell (05 §4 decision 2) | dropped | Browser app | [0003](0003-typescript-monorepo-stack.md) |
| 43 | Pilot scenario (05 §4 decision 1) | kept | Geopolitics / Hormuz is the M1 reference scenario; Palma second synthetic example | [0020](0020-build-order-milestones.md) |
| 44 | Phases 0–4 (05 §1–§2) | changed | Milestones M0, M1, M2+ | [0020](0020-build-order-milestones.md) |
| 45 | Federation, signatures, hub (04 §10; 05 §4 decision 5) | changed | Model kept open; P2P E2E; platform outside the repo | [0021](0021-privacy-and-sharing-model.md) |
| 46 | German UI in phase 1 (05 §3) | changed | English with i18n; German locale later | [0002](0002-english-repository-language.md) |
| 47 | Custom card types `custom:*` (03 §3) | changed | `type` is an open vocabulary | [0023](0023-core-domain-model.md) |
| 48 | No fine-tuning (05 §3) | changed | Opt-in training export now; fine-tuning later | [0017](0017-decision-card-and-training-export.md) |
| 49 | Dependency direction enforced by lint (04 §3) | kept | Plus "Apache never imports AGPL" | [0003](0003-typescript-monorepo-stack.md), [0004](0004-two-tier-licensing.md) |

### Consequences

- Good, because every concept decision has a traceable fate.
- Good, because deferred items are explicit candidates for slice ADRs.
- Bad, because the concept documents now disagree with the ADRs in many
  places until they are translated and annotated in `docs/product/`.

### Confirmation

When the concept documents move to `docs/product/`, each superseded
section gets a note linking the ADR listed here (review checklist).

## Pros and Cons of the Options

### One ADR per item

- Good, because maximal granularity.
- Bad, because about fifty near-trivial ADRs.

### Rewrite in place

- Good, because one current document.
- Bad, because the reasons for change are lost.

### One reconciliation ADR

- Good, because complete and compact.
- Bad, because a long table.

## More Information

- Supersedes concept v1: the items listed in the table, as stated.
- Section references: 01 = `docs/01-vision.md`, 02 = `docs/02-ux-board.md`,
  03 = `docs/03-datenmodell.md`, 04 = `docs/04-architektur.md`,
  05 = `docs/05-roadmap.md`.
- Related: [ADR-0001](0001-record-architecture-decisions.md),
  [ADR-0020](0020-build-order-milestones.md),
  [ADR-0025](0025-engineering-process-and-quality-gates.md),
  [ADR-0026](0026-security-defaults.md).
