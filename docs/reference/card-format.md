# Card format v2

Specification of the Markdown card format that The Worldbuilder reads and writes. Files are
the truth: a card is one Markdown file with YAML front matter, and any database or index is
derived and rebuildable.

::: info Status
This page is the human-readable specification of the canonical model decided in
[ADR-0023](../adr/0023-core-domain-model.md) (which is normative here), together with
[ADR-0006](../adr/0006-files-are-the-truth.md), [ADR-0007](../adr/0007-epistemic-layer-field.md),
[ADR-0008](../adr/0008-believed-as-private-stance.md) and
[ADR-0009](../adr/0009-mandatory-provenance.md). The machine-readable contract is the set of
JSON Schemas in [`schemas/`](https://github.com/Reraise-ai/reraise-app/tree/main/schemas),
which are in progress in milestone M0. If this page and a published schema differ, the
schema wins and this page is a bug. The reference `markdown-files` storage adapter (planned
M1) will implement this format, and the conformance kit will test it.
:::

The format is **store-neutral**. It is a generic specification that any store can implement.
It is structurally compatible with the card format v2 used by an existing Markdown card
store: every field there has a one-to-one counterpart here (see
[Mapping](#mapping-from-the-legacy-german-field-names)), so a storage adapter can translate
in both directions without loss.

## 1. Principles

- **v2 only adds.** No existing card needs rewriting. A card without a v2 field is validated
  as before. The v2 rules apply once a card uses a v2 field or declares `format: 2`.
- **Files are the truth.** Reference-adapter behaviour (planned M1): the `markdown-files` adapter will write
  through one write path per store that validates every v2 card with the schema rules and takes
  a lock before writing. A card that fails is not written. Other stores have their own write
  channel; the conformance kit tests the contract, not the mechanism.
- **Provenance is mandatory.** See [section 5](#5-provenance-rules).
- **Nothing is deleted.** A rewrite archives the previous version
  ([section 10](#10-archive-on-rewrite)).
- **Stances are not in the card.** A user's stance on a card is private and stored apart
  ([ADR-0008](../adr/0008-believed-as-private-stance.md)). See
  [section 11](#11-what-is-not-in-the-card).
- **Updates are patches.** An adapter changes only the canonical fields the product changed.
  Everything else in the file stays verbatim: unknown fields, store fields the product does not
  own, formatting and order.

## 2. File layout

A card is a UTF-8 Markdown file. The front matter is a YAML block between `---` lines. The
body follows as Markdown.

```markdown
---
format: 2
id: 01J9ZQ7K3M5V8W2X4Y6Z0A1B2C
type: claim
title: Tanker traffic down 12 percent in the harbour
layer: evidenced
source: harbour-statistics-2026-10.pdf p.4
sourceDate: 2026-10-01
author: human
worlds: [Geopolitics]
visibility: private
release: private
training: false
edges: [01J9ZQ7K3M5V8W2X4Y6Z0A1B2D|supports|human]
synthetic: true # repository hygiene marker for example data, not a card field
---

Traffic in the harbour fell by twelve percent compared with the previous month.
```

Lists use YAML flow sequences: square brackets with comma-separated entries. Because entries
are comma-separated, the text of an entry in `edges` and in the player fields must not
contain a comma or square brackets.

## 3. Fields

### 3.1 Base fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string (ULID) | yes | canonical, globally unique card id, see [Identity](#identity) |
| `externalId` | string | derived | the store-local id (for example `x-14`). Derived by the adapter, never written to the front matter of the reference format, where it equals `id`. |
| `uri` | string | derived | `wb:<storeInstanceId>/<externalId percent-encoded>`. Derived by the adapter, never written to the front matter. |
| `format` | `1` or `2` | yes (canonical) | see [Format versions](#format-versions) |
| `collection` | enum | no | `actors`, `evidence`, `decisions` |
| `type` | string | yes | open vocabulary, see [Types](#types) |
| `typeRaw` | string | for foreign stores | the store's original type value, never rewritten by a patch |
| `title` | string | yes | short title |
| `body` | Markdown | no | the Markdown after the front matter |
| `date` | ISO date | no | date of the card |
| `source` | string | see rules | text, URI or card id |
| `sourceDate` | ISO date | no | date of the source |
| `sourceChecksum` | string | no | SHA-256 of the **original source document**. Must be SHA-256 on `collection: evidence`. On other cards any string is accepted with a warning only. |
| `contentHash` | string | derived | `sha256:` plus lower-case hex SHA-256 of the RFC 8785 (JCS) serialisation of the card content ([ADR-0034](../adr/0034-content-hash.md)). Computed by the product on every read, never written to the front matter. Not the same as `sourceChecksum`. |
| `status` | enum | no | `draft`, `checked`, `released` |
| `rating` | string or number | no | carried as stored |
| `release` | enum | no | `private`, `community`, `commercial` |
| `visibility` | enum | no | `private`, `company_internal`, `cross_partner`, `customer_visible`, `public` |
| `carrier` | string | no | carried as stored |
| `affiliation` | string | no | carried as stored |
| `class` | enum | no | `A`, `B`, `C`. An input to disclosure-gate rules. |
| `tags` | list of text | no | free tags, unique. An input to disclosure-gate rules. |
| `level` | reserved | no | reserved for future card tiers. Unused. **Not** an epistemic field. |
| `signature` | reserved | no | reserved for author signatures. Unused. |

#### Identity

The reference `markdown-files` adapter stores the canonical ULID natively in `id`. A foreign
store keeps its own id in `externalId`, and the adapter derives the canonical `id`
deterministically from the card's `uri`: the 128 bits of the ULID are the first 128 bits of
SHA-256 of the `uri`, written as a 26-character Crockford base32 string. The same store card
therefore yields the same `id` on every read and every machine, with no sidecar state. Derived
ids are not time-sortable, so ordering uses dates. `storeInstanceId` is a random UUID created
once and persisted in the store's configuration. It is never a hostname, path or user name.
`externalId` is NFC-normalised, encoded as UTF-8, case preserved and percent-encoded per
RFC 3986. Every store-id reference (edge target, Lage card ids, `cardsUsed`, a player-field
`source` that is a card id) is resolved the same way. Callers must use the id returned by
`create` and never predict it. Details: [ADR-0023](../adr/0023-core-domain-model.md).

#### Format versions

`format` is `1` or `2`. A store card is format 2 if it has `format: 2` or uses any v2 field,
otherwise format 1. The format-2 rules (layer, author, provenance, edges, player fields, Lage,
decision sections) apply only to format-2 cards. A format-1 card without a layer has no
`layer` and is shown as "unclassified". Without an author it has `author: unknown`, which is
valid only on format-1 cards. Cards written by the product are always format 2.

#### Types

`type` is an open vocabulary. A foreign store's value is mapped and the original is kept in
`typeRaw`:

| Store `typ` | `type` |
| --- | --- |
| `akteur`, `person`, `organisation` | `actor`, `person`, `organisation` |
| `beleg` | `evidence` |
| `quelle` | `source` |
| `behauptung` | `claim` |
| `ereignis` | `event` |
| `erfahrung` | `experience` |
| `annahme` | `assumption` |
| `bewertung` | `rating` |
| `entscheidung` | `decision` |
| `regel` | `rule` |
| `thema` | `topic` |
| `lage` | `lage` |
| any other value | copied verbatim |

### 3.2 Fields added by v2

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | `2` | marks the card as a v2 card |
| `layer` | `evidenced`, `said`, `experience` | what kind of statement the card is |
| `worlds` | list of names | the worlds the card appears in, by reference. Never a copy. |
| `author` | `human` or `agent:<name>` (`unknown` on legacy format-1 cards only) | who created the card |
| `originSystem` | free text | which system the content came from |
| `training` | boolean | whether the card may be used for training. Default `false` (opt-in). |
| `edges` | list of `target\|kind\|by` | typed connections, see [section 4](#4-edges) |
| `interests`, `capabilities`, `dependencies`, `moves` | list of `text\|source` | player fields, only on `collection: actors`, see [section 6](#6-player-fields) |

A store's own-assessment field (legacy `einordnung`) is a conclusion, so it is **not** a card
field here. It is read as the note of the user's private stance on that card
([ADR-0023](../adr/0023-core-domain-model.md)) and stays verbatim in the store file.

`layer` has only three values. "Believed" is not a layer. It is a private stance and is
stored apart ([section 11](#11-what-is-not-in-the-card)). A legacy card whose epistemic kind
was `believed` is read as `layer: said` with the user as `author`, plus a believed stance.

## 4. Edges

An edge is one entry of the `edges` list with three parts separated by a vertical bar:

```
target|kind|by
```

- `target` is the id of an existing card. If the card does not exist the validator rejects
  the edge.
- `kind` is one of: `supports`, `refutes`, `represents`, `cites`, `based_on`, `depends_on`,
  `relation`, `unspecified`.
- `by` says who drew the edge: `human` or `agent:<name>`. `unknown` is valid for edges read
  from a legacy link list.

Example:

```yaml
edges: [01J9ZQ7K3M5V8W2X4Y6Z0A1B2D|supports|human, 01J9ZQ7K3M5V8W2X4Y6Z0A1B2E|represents|agent:scout]
```

A legacy list of plain links (the old `verknuepfungen` list) remains valid and is read as
edges of kind `unspecified` with `by: unknown`. Its targets are not checked strictly: a dangling entry yields a
hint, not an error.

## 5. Provenance rules

| Condition | Rule |
| --- | --- |
| `layer: evidenced` or `layer: said` | `source` **or** `originSystem` must be set |
| `layer: experience` | `author` must be set explicitly (not `unknown`) |
| any card with `format: 2` | `author` must be set |
| `format: 2` and `collection` is `evidence` or `actors` | `layer` must also be set |

The reason is in [provenance and independence](../explanation/provenance-and-independence.md)
and [ADR-0009](../adr/0009-mandatory-provenance.md). An own assessment cannot stand in as a
source: it must first be a card of its own (`layer: said`, `author: human`) that the entry can
cite.

## 6. Player fields

`interests`, `capabilities`, `dependencies` and `moves` describe what an actor wants, can do,
needs and does. They appear only on cards with `collection: actors`.

Each entry has the form `text|source`. The source is a card id or an address. **An entry
without a source is rejected.** Leave a field empty rather than asserting something without
evidence. Inside `text`, commas and square brackets are not allowed.

```yaml
interests: [Keep market share|01J9ZQ7K3M5V8W2X4Y6Z0A1B2F]
moves: [Naval exercise on 20 September|01J9ZQ7K3M5V8W2X4Y6Z0A1B2G]
```

## 7. The `lage` card

A Lage is a saved position on the board. It is a card with `type: lage`.

Front matter: `type: lage`, `format: 2`, `question` (required), `version` (number of this
version) and `updatedAt` (date of the last change).

The body contains a `## Position` section with one JSON block:

```json
{
  "question": "Does the situation escalate within three months?",
  "options": ["leave unchanged", "raise gold", "cut energy shares"],
  "cards": [{ "id": "01J9ZQ7K3M5V8W2X4Y6Z0A1B2C", "x": 120, "y": 80 }],
  "seats": [
    { "name": "Alex", "kind": "human" },
    { "name": "scout", "kind": "agent" }
  ],
  "edges": [
    { "from": "01J9ZQ7K3M5V8W2X4Y6Z0A1B2C", "to": "01J9ZQ7K3M5V8W2X4Y6Z0A1B2D", "kind": "supports", "by": "human" }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `question` | the guiding question as text |
| `options` | the list of options |
| `cards` | `{id, x, y}`: card references and their layout position |
| `seats` | `{name, kind}`: participants at the board. `kind` is `human` or `agent`. |
| `edges` | `{from, to, kind, by}`: edges drawn on this board |

All cards named must exist, and ids are resolved as described under [Identity](#identity). The
JSON must be readable. Positions are layout only and change
no card content.

## 8. The decision card

A card with `type: decision` and `format: 2` has exactly eleven sections in its body. Each is
introduced by a `##` heading and none may be empty. The canonical keys, and the headings of the
legacy store that map to them ([ADR-0017](../adr/0017-decision-card-and-training-export.md),
[ADR-0023](../adr/0023-core-domain-model.md)):

| # | Key | Reference heading | Store heading |
| --- | --- | --- | --- |
| 1 | `situation` | Situation | Situation |
| 2 | `trigger` | Trigger | Ausloeser |
| 3 | `conditions` | Conditions | Bedingungen |
| 4 | `facts` | Facts | Fakten |
| 5 | `priorities` | Priorities | Prioritaeten |
| 6 | `action` | Action | Handlung |
| 7 | `alternatives` | Alternatives | Alternativen |
| 8 | `exclusions` | Exclusions | Ausschluss |
| 9 | `rationale` | Rationale | Begruendung |
| 10 | `cardsUsed` | Cards used | Verwendete Karten |
| 11 | `outcome` | Outcome | Ergebnis |

The reference format writes the English headings of the third column, in this order
([ADR-0028](../adr/0028-json-schema-contract-conventions.md)). Store headings are matched with
and without umlaut transliteration (`ae`, `oe`, `ue`). Under `Cards used` each list item starts
with a card id.

While no outcome is known, the outcome section holds `open` (the store's word `offen` maps to
it). Ids named in `cardsUsed` must exist. Decision cards without `format: 2` are not affected.

### Rule cards

A card with `type: rule` may hold a structured rule ([ADR-0013](../adr/0013-rules-panel-replaces-barometer.md))
as one JSON block under a `## Rule` heading, like the Lage block. Its keys are `when` and
`unless` (lists of conditions) and `then` (the preferred action, as written); the shape is
fixed by `schemas/rule.schema.json`. Rule cards without the block stay valid as prose; only
structured rules are evaluated.

```json
{
  "when": [{ "kind": "card_on_lage", "card": "01J9ZQ7K3M5V8W2X4Y6Z0A1B2C" }],
  "then": "Reroute via the Cape",
  "unless": [{ "kind": "edge", "edgeKind": "refutes", "to": "01J9ZQ7K3M5V8W2X4Y6Z0A1B2C" }]
}
```

## 9. What the validator checks

For every v2 card:

1. `layer`, `training`, `author` and `format` have allowed values.
2. Every edge has an existing target, an allowed kind and a valid `by`.
3. Player fields appear only on actors and every entry has a source.
4. A `lage` card has readable JSON and names only existing cards.
5. A v2 decision card has all eleven sections.
6. The [provenance rules](#5-provenance-rules) hold.

Hints only, no error and no failing exit code: dangling targets in the legacy link list, and
a `sourceChecksum` on a card outside `collection: evidence` that is not a SHA-256 value.

## 10. Archive on rewrite

A `lage` card, and any other versioned card, is **archived** on rewrite
([ADR-0006](../adr/0006-files-are-the-truth.md)). The previous version moves to an archive folder next to the card, named
`_archive/<file>.v<n>.md`, where `n` is the version number. Nothing is deleted. The
validator does not look inside the archive. History is therefore a set of archived
versions, not an event log.

## 11. What is not in the card

- **Stances.** A user's position on a card (`believed`, `rejected`, `undecided`, with `weight`,
  `note`, `updatedAt` and history) is private and never leaves the device. It lives in local
  files under `.worldbuilder/stances/`, never in card files and never through a
  `StorageAdapter` of a shared or remote store. Stance-like fields that already exist in a store
  file (`ebene: geglaubt`, `einordnung`) are read and mapped, and left verbatim in the file.
  See [ADR-0008](../adr/0008-believed-as-private-stance.md) and
  [ADR-0012](../adr/0012-disclosure-gate.md).
- **Proposals.** A pending or rejected agent proposal is not a card
  ([ADR-0011](../adr/0011-agent-moves-are-proposals.md)).
- **Derived data.** A search index, an origin count or a rule evaluation can always be rebuilt
  from the files and is never the truth.

## Mapping from the legacy German field names

A store that uses the German header names maps one to one. The authoritative table is in
[ADR-0023](../adr/0023-core-domain-model.md); the conformance kit tests each row.

| Legacy field | Field here | Values |
| --- | --- | --- |
| `id` | `externalId` (plus `uri` and the derived `id`) | see [Identity](#identity) |
| `format` | `format` | `1`, `2` |
| `brett` | `collection` | `akteure`, `belege`, `entscheidungen` map to `actors`, `evidence`, `decisions` |
| `typ` | `type` and `typeRaw` | see [Types](#types) |
| `titel` | `title` | |
| `datum` | `date` | |
| `quelle`, `quelle_datum` | `source`, `sourceDate` | |
| `pruefsumme` | `sourceChecksum` | SHA-256 of the original source. Not `contentHash`. |
| `status` | `status` | `entwurf`, `geprueft`, `freigegeben` map to `draft`, `checked`, `released` |
| `bewertung` | `rating` | carried as stored |
| `freigabe` | `release` | `privat`, `community`, `kommerziell` map to `private`, `community`, `commercial` |
| `traeger` | `carrier` | carried as stored |
| `zugehoerigkeit` | `affiliation` | carried as stored |
| `sichtbarkeit` | `visibility` | `privat`, `gesellschaftsintern`, `partneruebergreifend`, `kundensichtbar`, `oeffentlich` map to `private`, `company_internal`, `cross_partner`, `customer_visible`, `public` |
| `klasse` | `class` | `A`, `B`, `C` |
| `ebene` | `layer` | `belegt`, `gesagt`, `erfahrung` map to `evidenced`, `said`, `experience`. `geglaubt` maps to `said` with `author: human` plus a believed stance. |
| `welten` | `worlds` | names resolved to World references. A World is created on demand. |
| `einordnung` | stance `note` | private, not on the card. Becomes the note of the believed stance, or of an `undecided` stance if the card is not `geglaubt`. |
| `urheber` | `author` | `mensch` maps to `human`, `agent:<name>` is unchanged, absent on format 1 maps to `unknown` |
| `herkunft_system` | `originSystem` | |
| `training` | `training` | `ja` maps to `true`, `nein` to `false`, absent to `false` |
| `kanten` (`ziel\|art\|von`) | `edges` (`target\|kind\|by`) | `stuetzt`, `widerlegt`, `vertritt`, `zitiert`, `beruht_auf`, `abhaengig_von`, `beziehung`, `unbestimmt` map to `supports`, `refutes`, `represents`, `cites`, `based_on`, `depends_on`, `relation`, `unspecified` |
| `verknuepfungen` | `edges` of kind `unspecified`, `by: unknown` | dangling targets are a warning |
| `interessen`, `faehigkeiten`, `abhaengigkeiten`, `zuege` | `interests`, `capabilities`, `dependencies`, `moves` | each `text\|source`, on `collection: actors` only |
| `lage`: `frage`, `optionen`, `karten`, `sitze`, `kanten` | `question`, `options`, `cards`, `seats`, `edges` | seat `art` (`mensch`, `agent`) becomes `kind` (`human`, `agent`). Edge `von`, `ziel`, `art`, `wer` become `from`, `to`, `kind`, `by`. `stand` becomes `updatedAt`. |
| decision sections | `situation` to `outcome` | `offen` maps to `open` |
| Lage body heading `## Stellung` | `## Position` | [ADR-0027](../adr/0027-card-format-mapping-addenda.md) |
| archive folder `_archiv/` | `_archive/` | [ADR-0027](../adr/0027-card-format-mapping-addenda.md) |

## See also

[Glossary](../glossary.md) ·
[Why layers never merge](../explanation/layers-never-merge.md) ·
[Provenance and independence](../explanation/provenance-and-independence.md) ·
[ADR log](../adr/) ·
[Schemas](https://github.com/Reraise-ai/reraise-app/tree/main/schemas)
