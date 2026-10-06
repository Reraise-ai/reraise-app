---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0002: English as repository language, German terms via a glossary

## Context and Problem Statement

Concept v1 was written entirely in German, and its domain vocabulary is
German (Lage, Brett, Sitz, Zug, BELEGT/GESAGT/GEGLAUBT). The product is
meant to work on top of any user's knowledge system worldwide, and its
first target users are operators of their own agent systems and second
brains. The owner's existing card store also uses German field names.
Which language do code, contracts, docs and commits use?

## Decision Drivers

- Universal product; outside contributors and adapter authors.
- One vocabulary in code and contracts, no mixed identifiers.
- The German domain terms carry meaning that must not be lost.
- Adapters must still read stores that use German field names.

## Considered Options

- English everywhere, German terms only in a glossary
- German everywhere (continue concept v1)
- Bilingual documents (German and English side by side)

## Decision Outcome

Chosen option: "English everywhere, German terms only in a glossary",
because it serves the universal audience and keeps one vocabulary, while
the glossary preserves the meaning of the original terms.

- Code, identifiers, schemas, API and MCP names, docs, ADRs, issues and
  commit messages are English.
- `docs/glossary.md` maps every German domain term to its English
  canonical term (for example Lage = situation board state, Sitz = seat,
  Zug = move, BELEGT = evidenced, GESAGT = said, GEGLAUBT = believed,
  Tür = the store's validator).
- German appears in the repository only in the glossary and in adapter
  mapping tables and their tests, where a store's German field values are
  data (for example `ebene: belegt`, see [ADR-0007](0007-epistemic-layer-field.md)).
- User-interface strings are English and go through an i18n layer from
  the first UI commit, so a German locale can be added as a later slice.
- German documents for the owner are produced outside the repository.

### Consequences

- Good, because adapter authors and contributors read one language.
- Good, because schema field names are stable English identifiers.
- Bad, because the concept v1 documents must be translated when they move
  to `docs/product/`, and nuance may be lost; the glossary mitigates this.
- Bad, because the first UI is not in the owner's native language until
  the German locale lands.

### Confirmation

Review checklist; the "no real data" CI job does not police language, so
reviewers check new identifiers and docs.

## Pros and Cons of the Options

### English plus glossary

- Good, because it matches the target audience.
- Bad, because translation work up front.

### German everywhere

- Good, because no translation of concept v1.
- Bad, because it excludes most adapter authors and contributors.

### Bilingual documents

- Good, because nothing is lost.
- Bad, because two copies drift apart; double maintenance.

## More Information

- Supersedes concept v1: the German language of all concept documents and
  `docs/05-roadmap.md` §3 ("Mehrsprachige Oberfläche später; Phase 1 ist
  deutsch").
- Related: [ADR-0001](0001-record-architecture-decisions.md),
  [ADR-0007](0007-epistemic-layer-field.md).
