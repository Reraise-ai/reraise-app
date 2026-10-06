---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0043: `wb digest` regenerates atlas pages deterministically, with card links and a staleness check

## Context and Problem Statement

Agents orient themselves with summary pages over the cards (an atlas or wiki). In the measured
installation of [ADR-0039](0039-knowledge-loop-receipts.md) the atlas was days out of date, and
nothing said so. Summary pages written by a model also drift away from the cards they claim to
summarise. How are atlas pages built so that every statement points to its cards, regeneration
needs no model, and an out-of-date page is detected?

## Decision Drivers

- Every line traceable to card ids ([ADR-0009](0009-mandatory-provenance.md)).
- Derived and rebuildable, never a second truth ([ADR-0006](0006-files-are-the-truth.md)).
- Works without a model; a model may improve the wording later.
- What the atlas shows to agents passes the disclosure gate ([ADR-0012](0012-disclosure-gate.md)).
- Staleness must be a computed fact, not a date guess.

## Considered Options

- Model-written summaries on a schedule
- Hand-written atlas pages
- A deterministic builder from cards, one structured page model per scope, with content-hash
  staleness; a model may reword lines later under the same model (chosen)

## Decision Outcome

Chosen option: "deterministic builder with a page model and hash staleness", because it is
reproducible, cites every card, and makes staleness checkable from the files alone.

### Page model

`schemas/digest-page.schema.json` (`DigestPage`): `pageId` (lower-case slug), `title`,
`scope` (`{kind: world, worldId}` or `{kind: unassigned}`), `target` (the gate target it was
built for; a `PackageTarget`, never `share`), `generatedAt`, `generator` (`deterministic` or
`model:<engine>`), `lines[]` (`{text, cardIds}`, at least one card id per line) and
`sources[]` (`{cardId, contentHash}`, one per card the page covers).

- Cross-check `digest-lines` (in `validate:schemas`): every card id of a line is in `sources`, and
  every source is cited by at least one line.
- The page model holds titles, types, layers and dates of cards: it is content. It is a derived
  local view like an index; it is never shared and never sent to a model as such. Models get
  cards only through context packages.

### Deterministic builder

`buildDigest(cards, worlds, options)` in `packages/knowledge-loop`:

- one page per world (`pageId` `world-<worldId in lower case>`, title the world name) and one
  page `unassigned` for cards without a world; a card in several worlds appears on each of their
  pages; Lage cards are left out (a Lage is a board, not knowledge);
- one line per card, grouped by `type`, sorted by type, then title, then id; the line text is
  `<title> (<layer or unclassified>, <type>[, <date>])` with line breaks removed;
- Markdown rendering: one bullet per line, in page order, ending in a link per card id,
  `[<id>](<uri or id>)`, using the card's `wb:` URI when it has one
  ([ADR-0005](0005-universal-adapter-architecture.md)); a header comment says the file is
  generated;
- the same cards, worlds and time give byte-identical output.

### Staleness

`checkDigestPage(page, cards)` compares a page with the current cards of its scope (after the
same gate filter):

- **changed**: a source whose card's current `contentHash` differs ([ADR-0034](0034-content-hash.md));
- **removed**: a source whose card is gone or no longer in scope;
- **added**: a card in scope that is not a source.

A page is fresh when all three are empty, otherwise stale. The atlas lag of
[ADR-0041](0041-usage-ledger-and-metrics.md) is computed from this.

### Gate

- `wb digest` builds for one target, default `local_model`, because the atlas exists for agents.
  Cards are filtered with the reference disclosure gate and the user's gate rules
  (`<state>/gate-rules.yaml` or `--gate-rules`), so an atlas never shows an agent a card the
  rules deny. Without a rule file the gate denies everything and the atlas is empty, with a
  warning.
- `cloud_model` and `share` are refused: cloud content leaves only through a confirmed transfer
  ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)) and conclusions never go to other
  people ([ADR-0036](0036-conclusions-are-private.md)).

### Command line

`wb digest --store <dir> [--out <dir>] [--target screen|local_model|demo] [--gate-rules <file>]
[--check]`:

- reads the `markdown-files` store read-only (no watcher, no lock), writes `<pageId>.json` (the
  page model) and `<pageId>.md` per page into `--out` (default `<state>/atlas`), and removes no
  other files;
- `--check` writes nothing and compares the existing pages with the store;
- exit codes: **0** pages written (with `--check`: every page fresh); **1** with `--check`: at
  least one page stale or missing; **2** usage error, unreadable store or refused target.

A model-written variant (`generator: model:<engine>`) is a later slice: it may only reword lines
of a deterministic page, keeps every line's card ids, and goes through a `ModelConnector` behind
the gate. Until then the deterministic builder is the only generator.

### Consequences

- Good, because every atlas line names its cards and staleness is exact.
- Good, because the nightly job needs no model and cannot invent content.
- Bad, because deterministic pages are lists, not prose; the model slice improves wording.
- Bad, because the atlas for agents is empty until the user writes gate rules, by design.

### Confirmation

`packages/knowledge-loop` digest tests: page per world plus unassigned, sort order, line text,
links by URI, Lage cards left out, determinism, every line cites a source and every source a line;
staleness reports changed, removed and added cards; the gate filter drops denied cards; the
command line writes pages, `--check` returns 1 after a card changes and 0 after regeneration, and
refuses `cloud_model`. Schema fixtures: a valid page; invalid ones with a line without card ids,
target `share` and (cross-check `digest-lines`) a line citing a card that is not a source.

## Pros and Cons of the Options

### Model summaries

- Good, because readable prose.
- Bad, because not reproducible, may invent content, needs a model every night.

### Hand-written pages

- Good, because best quality.
- Bad, because the measured failure: nobody keeps them current.

### Deterministic builder

- Good, because exact, cited and cheap.
- Bad, because terse.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0006](0006-files-are-the-truth.md), [ADR-0039](0039-knowledge-loop-receipts.md),
  [ADR-0041](0041-usage-ledger-and-metrics.md).
