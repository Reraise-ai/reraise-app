---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0014: No ingestion; the inbox lists new findings from connected sources

## Context and Problem Statement

Concept v1 planned an ingest pipeline: fetch URLs, PDFs and podcast
transcripts, let an LLM extract statements, triage them in an inbox, plus
quick capture with voice memos. It also left open whether a cloud or a
local model should do that extraction. The owner decided that card intake
is not our job: users create cards in their own AI systems (wikis, second
brains, document pipelines, transcript tools). What remains of the inbox?

## Decision Drivers

- Owner decision: read and reference via adapters; do not build
  ingestion of podcasts or articles.
- Provenance must be kept for everything that appears on the board.
- No copies of third-party content beyond what is needed to display it.
- The gap audit flags that the inbox must not imply ingestion.

## Considered Options

- Ingest pipeline with LLM extraction (concept v1)
- Bulk import of external content into our store
- Inbox of findings from `SourceConnector`s, reference-then-pin (chosen)

## Decision Outcome

Chosen option: "Inbox of findings, reference-then-pin", because it gives
the user a view of what is new in connected systems without us becoming
an intake pipeline.

- The inbox shows "new findings from connected sources": results that
  `SourceConnector`s report ([ADR-0005](0005-universal-adapter-architecture.md)),
  each with a reference (`uri`, connector, `originSystem`, retrieval time)
  and the provenance the source provides.
- Nothing in the inbox is part of a world. Pinning is an explicit human
  action: it places an existing card on a Lage or creates a reference card
  (`uri` plus minimal display text) through the `StorageAdapter`.
- Agents may suggest findings or pins only as proposals
  ([ADR-0011](0011-agent-moves-are-proposals.md)).
- Humans may still author a card directly on the board; that is authoring,
  not ingestion.
- Planned connectors (M2+): Obsidian vault, generic HTTP/JSON, a
  document-management system; later paid news services and legal
  databases. All go through the disclosure gate on egress.

### Consequences

- Good, because no extraction quality, cost or copyright problems in our
  scope; the open question "cloud vs local model for ingest" disappears.
- Good, because cards keep their home system and provenance.
- Bad, because a user without an own intake system starts with an empty
  world; docs must show how to connect an existing vault in minutes.
- Bad, because inbox quality depends on each source's search capability.

### Confirmation

There is no package or endpoint that fetches and extracts external
content. UI review checks the inbox wording ("findings from connected
sources", never "import" or "ingest"). Connector contract tests require a
`uri` and provenance on every finding.

## Pros and Cons of the Options

### Ingest pipeline

- Good, because self-contained product.
- Bad, because rejected by the owner; costly, error-prone, duplicates the
  user's own systems.

### Bulk import

- Good, because fast to fill a world.
- Bad, because copies data and loses the link to its home system.

### Inbox of findings

- Good, because universal and provenance-preserving.
- Bad, because depends on connectors.

## More Information

- Supersedes concept v1: `docs/04-architektur.md` §8 ingest pipeline and
  `packages/ingest`, `docs/02-ux-board.md` §6 inbox triage of extracted
  statements and §9 quick capture, `docs/05-roadmap.md` §4 open decision 3
  (default LLM for ingest), and the M1 "done" criterion of concept phase 1
  requiring podcast or article ingest.
- Related: [ADR-0005](0005-universal-adapter-architecture.md),
  [ADR-0009](0009-mandatory-provenance.md),
  [ADR-0012](0012-disclosure-gate.md).
