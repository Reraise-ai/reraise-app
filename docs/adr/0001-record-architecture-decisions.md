---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0001: Record architecture decisions as MADR files

## Context and Problem Statement

The Worldbuilder is a public open-source project built by several humans
and agents in parallel. The first concept (v1, German, `docs/01-vision.md`
to `docs/05-roadmap.md`) embedded its decisions in long prose documents,
and a later product hand-over changed several of them. Without a single,
reviewable log, nobody can tell which rule is current, why it was chosen,
or which earlier idea it replaced.

## Decision Drivers

- Every schema, contract or canon change must be traceable to a decision.
- Decisions must be reviewable in small pull requests.
- Superseded ideas must stay visible (with the reason) instead of silently
  disappearing.
- The format must be well known to outside contributors.

## Considered Options

- MADR 4.0 files in `docs/adr/`
- Nygard-style ADRs (status, context, decision, consequences only)
- Keep decisions inside the design documents (arc42 section 9 only)

## Decision Outcome

Chosen option: "MADR 4.0 files in `docs/adr/`", because it adds explicit
considered options and confirmation to the Nygard format, is a published
standard with tooling, and fits one-decision-per-pull-request review.

Rules:

- One file per decision: `docs/adr/NNNN-kebab-title.md`, numbered
  sequentially, never renumbered. The index is [README.md](README.md),
  the blank form is [template.md](template.md).
- Front matter holds `status`, `date` and `decision-makers`. Allowed
  statuses: `proposed`, `accepted`, `rejected`, `deprecated`,
  `superseded by ADR-NNNN`.
- An accepted ADR is not rewritten in substance. A change of mind is a new
  ADR that supersedes the old one; the old one only gets its status line
  updated. Typos and broken links may be fixed in place.
- Every ADR that overrides the German concept v1 says so in a
  "Supersedes concept v1" line, naming the section.
- An ADR is required for any change to `schemas/`, to the adapter
  interfaces, to MCP tool definitions, to the OpenAPI contract, or to the
  product canon (layers, provenance, privacy, proposals).
- ADRs are written in English ([ADR-0002](0002-english-repository-language.md)).

### Consequences

- Good, because reviewers and future contributors can see the current rule
  and its reason in one place.
- Good, because conflicts between the concept and the hand-over are
  resolved explicitly ([ADR-0024](0024-concept-v1-reconciliation.md)).
- Bad, because every contract change now costs an extra file and review.

### Confirmation

The pull request template's Definition of Done contains "ADR added or
linked if a decision, schema or canon changed". Reviewers reject contract
changes without an ADR.

## Pros and Cons of the Options

### MADR 4.0

- Good, because options and trade-offs are recorded, not only the result.
- Good, because the "Confirmation" section ties a decision to a check.
- Bad, because it is longer than a Nygard ADR.

### Nygard-style ADRs

- Good, because it is minimal.
- Bad, because rejected alternatives are easily lost.

### Decisions inside design documents

- Good, because no extra files.
- Bad, because history and supersession are invisible; this is what made
  concept v1 hard to reconcile.

## More Information

- Supersedes concept v1: the "Offene Owner-Entscheidungen" table in
  `docs/05-roadmap.md` §4 as the place where decisions are tracked.
- Related: [ADR-0024](0024-concept-v1-reconciliation.md).
