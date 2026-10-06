---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0023: Core domain model compatible with the owner's card format v2

## Context and Problem Statement

The product needs one canonical model for cards, edges and Lagen (board
states) that every adapter maps to. The owner's live card store (card
format v2, German field names, store-local ids such as `x-14`) must map
1:1 in both directions, including legacy (format 1) cards, and concept v1
had a much larger, event-sourced model. Which fields form the contract in
M0, and how do foreign ids become stable canonical ids?

## Decision Drivers

- Lossless round-trip of card format v2 ([ADR-0006](0006-files-are-the-truth.md)).
- Canonical ids must be stable across reads and survive deleting every
  derived index.
- Legacy cards stay valid exactly as the store's validator treats them.
- Keep the model minimal; extend by ADR per slice.

## Considered Options

Model:

- Concept v1 model (typed `data` per type, memberships, lenses, snapshots)
- Card format v2 verbatim (German field names)
- A minimal English canonical model with explicit named fields for every
  card format v2 field (chosen)

Identity of foreign cards:

- Mint a ULID once and persist it in a sidecar or derived index keyed by
  store id
- Derive the ULID deterministically from the card's URI (chosen)
- Use the store id itself as canonical `id`

## Decision Outcome

Chosen options: "minimal English canonical model with explicit named
fields" and "derive the ULID deterministically from the URI", because the
first round-trips every store field without German identifiers, and the
second needs no extra state: the same store card yields the same `id` on
every read, on every machine, after any index rebuild. A sidecar would be
state outside the files (contradicting ADR-0006 if kept in a derived
index, and lost on rebuild); store ids are not globally unique.

### Identity

- Every card has `externalId` (the store-local id, for example `x-14`)
  and `uri`, a stable adapter-defined URI built from the store instance
  and `externalId`.
- If the store record carries a canonical ULID of its own, that is `id`.
  Otherwise `id` = derived ULID: the 128 bits of the ULID are the first
  128 bits of SHA-256(`uri`), encoded as a 26-character ULID string
  (Crockford base32). Derived ids are not
  time-sortable; ordering uses dates.
- Every store-id reference is resolved the same way: edge `ziel`, Lage
  `karten[].id` and Lage `kanten` `von` / `ziel`, decision `cardsUsed`
  entries, player-field `source` when it is a card id. Canonical objects
  hold the derived `id`; adapters write the store id back.

### Format versions

- Canonical `format ∈ {1, 2}`. A store card is format 2 if it has
  `format: 2` or uses any v2 field; otherwise format 1.
- Format-2 rules (layer, author, provenance, edges, player fields, Lage,
  decision sections) apply only to format-2 cards, exactly like the
  store's validator ([ADR-0007](0007-epistemic-layer-field.md),
  [ADR-0009](0009-mandatory-provenance.md)).
- Legacy defaults: a format-1 card without `ebene` has no `layer` and is
  shown as "unclassified"; without `urheber` it has `author: unknown`.
  `unknown` is valid only on format-1 cards.
- Cards written by the product are always format 2; adapters emit
  `format: 2`.

### Card fields and mapping

| Card format v2 | Canonical field | Values / notes |
| --- | --- | --- |
| `id` | `externalId` (+ `uri`, derived `id`) | see Identity |
| `format` | `format` | `1` / `2` |
| `brett` | `collection` | `akteure`→`actors`, `belege`→`evidence`, `entscheidungen`→`decisions` |
| `typ` | `type` | open vocabulary (person, organisation, actor, event, claim, source, assumption, rating, decision, rule, topic, `lage`, …) |
| `titel` | `title` | text |
| body | `body` | Markdown |
| `datum` | `date` | ISO date |
| `quelle` | `source` | text, URI or card id |
| `quelle_datum` | `sourceDate` | ISO date |
| `pruefsumme` | `sourceChecksum` | SHA-256 of the original source document; explicitly not `contentHash` |
| – | `contentHash` | SHA-256 of canonical card content, computed by us |
| `status` | `status` | `entwurf`→`draft`, `geprueft`→`checked`, `freigegeben`→`released` |
| `bewertung` | `rating` | carried as stored |
| `freigabe` | `release` | `privat`→`private`, `community`→`community`, `kommerziell`→`commercial` |
| `traeger` | `carrier` | carried as stored |
| `zugehoerigkeit` | `affiliation` | carried as stored |
| `sichtbarkeit` | `visibility` | `privat`→`private`, `gesellschaftsintern`→`company_internal`, `partneruebergreifend`→`cross_partner`, `kundensichtbar`→`customer_visible`, `oeffentlich`→`public` |
| `klasse` | `class` | `A` / `B` / `C`; input to disclosure-gate rules |
| `ebene` | `layer` | `belegt`→`evidenced`, `gesagt`→`said`, `erfahrung`→`experience`; `geglaubt` → `said` + stance believed ([ADR-0008](0008-believed-as-private-stance.md)) |
| `welten` | `worlds` | list of world names, references only |
| `einordnung` | stance `note` (private, not on the card) | see below |
| `urheber` | `author` | `mensch`→`human`, `agent:<name>`→`agent:<name>`; absent on format 1 → `unknown` |
| `herkunft_system` | `originSystem` | text |
| `training` | `training` | `ja`→`true`, `nein`→`false`; absent → `false` |
| `kanten` `ziel\|art\|von` | `edges[{target, kind, by}]` | `stuetzt`→`supports`, `widerlegt`→`refutes`, `vertritt`→`represents`, `zitiert`→`cites`, `beruht_auf`→`based_on`, `abhaengig_von`→`depends_on`, `beziehung`→`relation`, `unbestimmt`→`unspecified`; `von` as `urheber` |
| `verknuepfungen` (legacy) | `edges` of kind `unspecified`, `by: unknown` | dangling targets are a warning, not an error |
| `interessen`, `faehigkeiten`, `abhaengigkeiten`, `zuege` | `interests`, `capabilities`, `dependencies`, `moves` | each `{text, source}`; only on `collection: actors` |
| – | `level`, `signature` | reserved, unused |

Format-2 requirement "ebene on evidence and actors" maps to: `layer` is
required when `format = 2` and `collection ∈ {evidence, actors}`.

`einordnung` (own assessment of a foreign claim) is a conclusion and
becomes the user's stance note: if the card also has `ebene: geglaubt`,
it is the note of that `believed` stance; otherwise a stance with
`position: undecided` and this note is created. It never stays on the
canonical card.

### Lage (type `lage`)

| Card format v2 | Canonical |
| --- | --- |
| `frage` (front matter and JSON) | `question` (required) |
| `version` | `version` |
| `stand` | `updatedAt` |
| `optionen` | `options[]` |
| `karten[{id, x, y}]` | `cards[{id, x, y}]` (ids resolved as above) |
| `sitze[{name, art}]`, `art` `mensch` / `agent` | `seats[{name, kind}]`, `kind` `human` / `agent` |
| `kanten[{von, ziel, art, wer}]` | `edges[{from, to, kind, by}]` (kinds as above) |

A rewrite archives the previous version ([ADR-0006](0006-files-are-the-truth.md)).

### Decision card sections

| Heading in the store | Key |
| --- | --- |
| Situation | `situation` |
| Auslöser | `trigger` |
| Bedingungen | `conditions` |
| Fakten | `facts` |
| Prioritäten | `priorities` |
| Handlung | `action` |
| Alternativen | `alternatives` |
| Ausschluss | `exclusions` |
| Begründung | `rationale` |
| Verwendete Karten | `cardsUsed` |
| Ergebnis | `outcome` (`offen` → `open`) |

Headings are matched with and without umlaut transliteration (`ae`, `oe`,
`ue`). See [ADR-0017](0017-decision-card-and-training-export.md).

### Consequences

- Good, because every store field round-trips under an English name, so
  the conformance kit can test each row.
- Good, because canonical ids are stable without any persisted mapping.
- Bad, because derived ULIDs lose time ordering, and changing a store's
  URI scheme changes every id (the URI scheme is therefore part of an
  adapter's stable contract).
- Bad, because concept v1 features (premises, memberships with role and
  weight, per-lens layouts) are not in the contract yet
  ([ADR-0024](0024-concept-v1-reconciliation.md)).

### Confirmation

JSON Schemas with valid and invalid synthetic examples for Card, Edge,
Lage, Decision and Stance. Conformance tests for every mapping row, for
id derivation (same URI → same id, across a derived-index rebuild), for
format detection and legacy defaults, and for the `einordnung` rule.

## Pros and Cons of the Options

### Concept v1 model

- Good, because rich and already specified.
- Bad, because built on an event log and does not map 1:1.

### Card format v2 verbatim

- Good, because zero mapping for one store.
- Bad, because German, owner-specific identifiers in a universal contract.

### Minimal canonical model with explicit fields

- Good, because universal and lossless.
- Bad, because some fields (`rating`, `carrier`, `affiliation`) are carried
  without product semantics yet.

### Sidecar ULID mapping

- Good, because ids stay time-sortable.
- Bad, because extra state outside the files; lost if kept in a derived
  index.

### Store id as canonical id

- Good, because no translation.
- Bad, because not globally unique across stores.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §2–§4, §7–§9 (`CardBase`
  with `data`, `Origin` / `AuthorRef`, `Visibility`, eleven relation types,
  `World` / `Membership` / `PremiseRef`, `Board` with phases, lenses and
  `BoardItem.parked`, `Snapshot`).
- Related: [ADR-0005](0005-universal-adapter-architecture.md),
  [ADR-0008](0008-believed-as-private-stance.md),
  [ADR-0009](0009-mandatory-provenance.md),
  [ADR-0017](0017-decision-card-and-training-export.md).
