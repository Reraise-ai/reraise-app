# 1. Introduction and goals

Status: this page describes the target system. What exists today is listed in the
[overview](./index.md#pages) legend and in [verification](../verification.md).

## 1.1 Requirements overview

The Worldbuilder is a personal layer between a person and any model or agent. It keeps the
person's world (cards with provenance, worlds, board situations and decisions) independent of
whichever model or agent system is in use, and it turns that world into concrete decision
situations on a board. The full product definition is in the [vision](../product/vision.md).

What the architecture must deliver, condensed:

| # | Requirement | Source |
| --- | --- | --- |
| R1 | Work on top of any user's knowledge store, second brain or multi-agent system. Cards are read and referenced, never ingested or copied. | [ADR-0005](../adr/0005-universal-adapter-architecture.md), [ADR-0014](../adr/0014-no-ingestion-inbox-of-findings.md) |
| R2 | Files are the truth. Every database or index is derived and rebuildable. | [ADR-0006](../adr/0006-files-are-the-truth.md) |
| R3 | Keep evidenced, said and experience apart; "believed" is a private stance overlay that never leaves the device. | [ADR-0007](../adr/0007-epistemic-layer-field.md), [ADR-0008](../adr/0008-believed-as-private-stance.md) |
| R4 | Provenance is mandatory and independence counts origins, not copies. | [ADR-0009](../adr/0009-mandatory-provenance.md) |
| R5 | The user's own agents act on the board, but only through proposals that a human accepts. | [ADR-0011](../adr/0011-agent-moves-are-proposals.md) |
| R6 | Nothing leaves the screen without an explicit allow per card and per target; cloud transfers need per-transfer confirmation. | [ADR-0012](../adr/0012-disclosure-gate.md) |
| R7 | The model is replaceable: one connector shape for local models, cloud models and the external decision service Jev. | [ADR-0015](../adr/0015-two-thinking-levels.md), [why the LLM is replaceable](../explanation/llm-is-replaceable.md) |
| R8 | Agents connect over MCP, the board over an HTTP API, both from one contract. | [ADR-0016](../adr/0016-mcp-first-and-openapi-contracts.md) |
| R9 | No verdicts: rules panel instead of a probability meter; fast answers are attributed estimates. | [ADR-0013](../adr/0013-rules-panel-replaces-barometer.md), [ADR-0015](../adr/0015-two-thinking-levels.md) |
| R10 | Decisions and their outcomes close the loop and can be exported (opt-in) as training traces. | [ADR-0017](../adr/0017-decision-card-and-training-export.md) |

The MVP-critical acceptance criteria (AC-01 to AC-33) are listed in the
[roadmap](../roadmap.md#mvp-critical-acceptance-criteria).

## 1.2 Quality goals

The five most important quality goals, in priority order. Each has testable scenarios in
[quality requirements](./10-quality.md).

| Priority | Quality goal | Short form |
| --- | --- | --- |
| 1 | **Privacy** | Nothing leaves the device without an explicit allow; stances never leave. A missing rule fails safe. |
| 2 | **Provenance integrity** | Every card, edge, player entry and accepted proposal keeps who said it and where it came from, across every adapter round trip. Agent output never silently becomes the user's knowledge. |
| 3 | **Replaceability** | Models, stores, sources and even the canvas library can be swapped by writing an adapter or connector; the world stays. |
| 4 | **Portability** | Runs on Windows, macOS and Linux from a clean machine; the data is plain files readable without our software. |
| 5 | **Reviewability** | Small, contract-first changes; every claim is backed by an automated check; decisions are traceable to ADRs. |

## 1.3 Stakeholders

| Stakeholder | Expectation of the architecture |
| --- | --- |
| End user (first target: operators of their own agent systems or second brains) | Connect an existing vault or agent in minutes; keep data local; see where every statement came from; no verdicts. |
| User's agents and multi-agent system | A stable MCP interface to read the active world and to propose moves. |
| Adapter authors | Language-neutral contracts (JSON Schema, OpenAPI), adapter interfaces and a conformance kit to prove their adapter. |
| Owner (maintainer) | Decides what, money and irreversible matters; operates an own store adapter outside this repository. See [governance](https://github.com/Reraise-ai/reraise-app/blob/main/GOVERNANCE.md). |
| Contributors and reviewing agents | Clear building-block boundaries, ADRs for every decision, required checks. |
| Security reporters | A documented privacy model and threat surface ([SECURITY.md](https://github.com/Reraise-ai/reraise-app/blob/main/SECURITY.md)). |

The owner's own card store is one backend among many. It is reached through a
`StorageAdapter` developed and operated outside this repository against the same contracts and
the same conformance kit ([ADR-0005](../adr/0005-universal-adapter-architecture.md)).
