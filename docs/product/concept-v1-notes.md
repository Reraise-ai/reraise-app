# Concept v1 notes (for the architect)

The first concept for this project was written in German as five documents under `docs/`:
vision, board UX, data model, architecture and roadmap. It has been superseded. The
documents were removed from the working tree in the docs restructure. They are not lost:
**concept v1 lives in git history at commit `c2b39de`.**

```sh
git show c2b39de --stat
git show c2b39de:docs/03-datenmodell.md
git show c2b39de:docs/04-architektur.md
```

## What carried forward

| Concept v1 document | Now |
| --- | --- |
| Vision | [Vision](./vision.md), rewritten in English from the owner's product definition plus the current canon |
| Board UX | [Board UX](./board-ux.md), updated to the canon |
| Scenarios (inside the UX document) | [Scenarios](./scenarios.md) |
| Roadmap | [Roadmap](../roadmap.md), mapped onto milestones M0, M1, M2+ |
| Data model | superseded, see below. Treat as input for the architect, not as a specification. |
| Architecture | superseded, see below. Treat as input for the architect, not as a specification. |

The prototype `prototype/board.html` is kept as a frozen design study.

## What was superseded

The binding record of each decision is the ADR log: see the [ADR index](../adr/README.md).
In short:

| Concept v1 said | Now | Why |
| --- | --- | --- |
| SQLite append-only event log as the source of truth, with projections | **Files are the truth**: Markdown with YAML front matter, compatible with the owner store's card format. Any database or index is derived and rebuildable. History is archived versions, not an event log. | The owner's store already works this way and the product must sit on top of any user's store. |
| Four epistemic kinds BELEGT, GESAGT, GEGLAUBT, ERFAHRUNG | Three layers `evidenced`, `said`, `experience`. "Believed" is a private **stance** overlay per user per card. | A belief is the user's position on a card, not a kind of knowledge. Keeps the field `level` free for card tiers. |
| Premise barometer weighting layers into support and weakening | **Rules panel**: which of the user's rules fired and which cards triggered them. No percentage. | A meter reads as a verdict and merges layers. |
| Ingest pipeline for URLs, transcripts and PDFs, with an inbox triage | **No ingestion.** An inbox of new findings from connected sources, referenced with provenance and pinned on demand. | Cards are created in the user's own AI. We read and reference. |
| One storage backend (our own SQLite store) | **Adapter architecture**: `StorageAdapter`, `SourceConnector`, `ModelConnector`, `DisclosureGate`. A reference `markdown-files` adapter proves the contract and a conformance kit tests any adapter. | The product must be universal. |
| AI ghost cards | **Proposals** `{id, author, kind, payload, status, decidedBy, decidedAt}` from humans and agents alike | Generalises the rule that nothing an agent proposed counts until a human accepted it. |
| Agent write tools | One agent write path only: `proposal_create` | Security rule. |
| Public-by-default platform sketch with federation | Out of scope. The data model keeps unique ids, content hash and reserved `level` and `signature` fields. | The platform is a separate, later concern. |
| Python or Node monolith sketches | TypeScript monorepo, pnpm workspaces, Node 22 | See the ADR log. |

## What the architect should still mine from v1

- The invariants list of the data model (for example: a decision's `cardsUsed` must exist,
  a seat field without a source is rejected, an agent can never create an accepted card).
  These are re-expressed in the [card format](../reference/card-format.md) and will be
  re-expressed in the JSON Schemas and conformance tests.
- The provenance algorithm sketch (origin roots and independence), now described in
  [provenance and independence](../explanation/provenance-and-independence.md).
- The context package pipeline: request, active world, relevant cards, relations,
  decisions, sources and provenance, context package. Now bounded by the disclosure gate.
- The platform outlook (content addressing, signatures, peer-to-peer exchange). Reserved
  fields only.

Treat anything in v1 that contradicts the canon in [Vision](./vision.md) as superseded.
