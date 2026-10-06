# Card format v2

Specification of the Markdown card format that The Worldbuilder reads and writes. Files are
the truth: a card is one Markdown file with YAML front matter, and any database or index is
derived and rebuildable.

::: info Status
This page is the human-readable specification. The machine-readable contract is the set of
JSON Schemas in [`schemas/`](https://github.com/Reraise-ai/reraise-app/tree/main/schemas),
which are being written in milestone M0. If this page and a published schema differ, the
schema wins and this page is a bug. The reference `markdown-files` storage adapter (planned
M1) will implement this format, and the conformance kit will test it.
:::

The format is **owner-neutral**. It is a generic specification that any store can implement.
It is structurally compatible with the card format v2 used by an existing Markdown card
store: every field there has a one-to-one counterpart here (see
[Mapping](#mapping-from-the-legacy-german-field-names)), so a storage adapter can translate
in both directions without loss.

## 1. Principles

- **v2 only adds.** No existing card needs rewriting. A card without a v2 field is validated
  as before. The v2 rules apply once a card uses a v2 field or declares `format: 2`.
- **Files are the truth.** Writing goes through one write channel of the store, which checks
  every v2 card with the same rules as the validator before writing. A card that fails is not
  written.
- **Provenance is mandatory.** See [section 5](#5-provenance-rules).
- **Nothing is deleted.** A rewrite archives the previous version
  ([section 10](#10-archive-on-rewrite)).
- **Stances are not in the card.** A user's stance on a card is private and stored apart.
  See [section 11](#11-what-is-not-in-the-card).

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
synthetic: true
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
| `id` | string (ULID) | yes | globally unique card id. Foreign ids are allowed through `externalId` or `uri`. |
| `contentHash` | string | no | sha256 of the canonical content. For evidenced cards it is the checksum of the source. |
| `type` | string | yes | card type, for example `actor`, `event`, `claim`, `source`, `experience`, `relation`, `assumption`, `rating`, `decision`, `rule`, `topic`, `lage`. |
| `title` | string | yes | short title |
| `body` | Markdown | no | the Markdown after the front matter |
| `date` | date | no | date of the card |
| `source` | string | see rules | where the content comes from (a card id or an address) |
| `sourceDate` | date | no | date of the source |
| `status` | enum | no | `draft`, `checked`, `released` |
| `rating` | string | no | the owner's rating of the card |
| `release` | enum | no | `private`, `community`, `commercial`: whether sharing is allowed at all |
| `visibility` | enum | no | who may see the card, see [Mapping](#mapping-from-the-legacy-german-field-names) |
| `class` | enum | no | sensitivity class `A`, `B`, `C` |
| `externalId`, `uri` | string | no | the id or address in a foreign system, for reference-by-URI |
| `level` | reserved | no | reserved for future card tiers. **Not** an epistemic field. |
| `signature` | reserved | no | reserved for author signatures |

### 3.2 Fields added by v2

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | `2` | marks the card as a v2 card |
| `layer` | `evidenced`, `said`, `experience` | what kind of statement the card is |
| `worlds` | list of names | the worlds the card appears in, by reference. Never a copy. |
| `classification` | one line | the owner's own assessment of a foreign statement |
| `author` | `human` or `agent:<name>` | who created the card |
| `originSystem` | free text | which system the content came from |
| `training` | boolean | whether the card may be used for training. Default `false` (opt-in). |
| `edges` | list of `target\|kind\|by` | typed connections, see [section 4](#4-edges) |
| `interests`, `capabilities`, `dependencies`, `moves` | list of `text\|source` | player fields, only on actors, see [section 6](#6-player-fields) |

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
- `by` says who drew the edge: `human` or `agent:<name>`.

Example:

```yaml
edges: [01J9ZQ7K3M5V8W2X4Y6Z0A1B2D|supports|human, 01J9ZQ7K3M5V8W2X4Y6Z0A1B2E|represents|agent:scout]
```

A legacy list of plain links (the old `verknuepfungen` list) remains valid and is read as
edges of kind `unspecified`. Its targets are not checked strictly: a dangling entry yields a
hint, not an error.

## 5. Provenance rules

| Condition | Rule |
| --- | --- |
| `layer: evidenced` or `layer: said` | `source` **or** `originSystem` must be set |
| `layer: experience` | `author` must be set |
| any card with `format: 2` | `author` must be set |
| evidenced cards and actors with `format: 2` | `layer` must also be set |

The reason is in [provenance and independence](../explanation/provenance-and-independence.md).

## 6. Player fields

`interests`, `capabilities`, `dependencies` and `moves` describe what an actor wants, can do,
needs and does. They appear only on actors.

Each entry has the form `text|source`. The source is a card id or an address. **An entry
without a source is rejected.** Leave a field empty rather than asserting something without
evidence. Inside `text`, commas and square brackets are not allowed.

```yaml
interests: [Keep market share|01J9ZQ7K3M5V8W2X4Y6Z0A1B2F]
moves: [Naval exercise on 20 September|01J9ZQ7K3M5V8W2X4Y6Z0A1B2G]
```

## 7. The `lage` card

A Lage is a saved position on the board. It is a card with `type: lage`.

Front matter: `type: lage`, `format: 2`, `question`, `version` (number of this version) and
`updatedAt` (date of the last change).

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

All cards named must exist. The JSON must be readable. Positions are layout only and change
no card content.

## 8. The decision card

A card with `type: decision` and `format: 2` has exactly eleven sections in its body. Each is
introduced by a `##` heading and none may be empty:

1. Situation
2. Trigger
3. Conditions
4. Facts
5. Priorities
6. Action
7. Alternatives
8. Exclusions
9. Rationale
10. Cards used
11. Outcome

While no outcome is known, the Outcome section contains the word `open`. Ids named in "Cards
used" must exist. Older decision cards without `format: 2` are not affected. In the model
these sections are the fields `situation`, `trigger`, `conditions`, `facts`, `priorities`,
`action`, `alternatives`, `exclusions`, `rationale`, `cardsUsed` and `outcome`.

## 9. What the validator checks

For every v2 card:

1. `layer`, `training`, `author` and `format` have allowed values.
2. Every edge has an existing target, an allowed kind and a valid `by`.
3. Player fields appear only on actors and every entry has a source.
4. A `lage` card has readable JSON and names only existing cards.
5. A v2 decision card has all eleven sections.
6. The [provenance rules](#5-provenance-rules) hold.

Hints only, no error and no failing exit code: dangling targets in the legacy link list, and
a `contentHash` on a non-evidenced card that is not a sha256 value.

## 10. Archive on rewrite

A `lage` card, and any card a store rewrites rather than appends to, is **archived** on
rewrite. The previous version moves to an archive folder next to the card, named
`_archive/<file>.v<n>.md`, where `n` is the version number. Nothing is deleted. The
validator does not look inside the archive. History is therefore a set of archived
versions, not an event log.

## 11. What is not in the card

- **Stances.** A user's position on a card (`believed`, `rejected`, `undecided`, with
  `weight`, `note`, `updatedAt` and history) is private and never leaves the device. It is
  stored apart from the card.
- **Derived data.** A search index, an origin count or a rule evaluation can always be
  rebuilt from the files and is never the truth.

## Mapping from the legacy German field names

A store that uses the German header names maps one to one:

| Legacy field | Field here | Values |
| --- | --- | --- |
| `id` | `id` | |
| `typ` | `type` | |
| `titel` | `title` | |
| `datum` | `date` | |
| `quelle`, `quelle_datum` | `source`, `sourceDate` | |
| `pruefsumme` | `contentHash` | sha256 |
| `status` | `status` | `entwurf`, `geprueft`, `freigegeben` map to `draft`, `checked`, `released` |
| `bewertung` | `rating` | |
| `freigabe` | `release` | `privat`, `community`, `kommerziell` map to `private`, `community`, `commercial` |
| `sichtbarkeit` | `visibility` | `privat`, `gesellschaftsintern`, `partneruebergreifend`, `kundensichtbar`, `oeffentlich` map to `private`, `organisation`, `partners`, `customers`, `public` |
| `klasse` | `class` | `A`, `B`, `C` |
| `format` | `format` | `2` |
| `ebene` | `layer` | `belegt`, `gesagt`, `erfahrung` map to `evidenced`, `said`, `experience`. `geglaubt` maps to `said` with a believed stance. |
| `welten` | `worlds` | |
| `einordnung` | `classification` | |
| `urheber` | `author` | `mensch` maps to `human`, `agent:<name>` is unchanged |
| `herkunft_system` | `originSystem` | |
| `training` | `training` | `ja` maps to `true`, `nein` to `false` |
| `kanten` (`ziel\|art\|von`) | `edges` (`target\|kind\|by`) | `stuetzt`, `widerlegt`, `vertritt`, `zitiert`, `beruht_auf`, `abhaengig_von`, `beziehung`, `unbestimmt` map to `supports`, `refutes`, `represents`, `cites`, `based_on`, `depends_on`, `relation`, `unspecified` |
| `interessen`, `faehigkeiten`, `abhaengigkeiten`, `zuege` | `interests`, `capabilities`, `dependencies`, `moves` | each `text\|source` |
| `lage` card: `frage`, `optionen`, `karten`, `sitze`, `kanten` | `question`, `options`, `cards`, `seats`, `edges` | seat `art` becomes `kind`, edge `ziel` becomes `to`, `art` becomes `kind`, `wer` becomes `by` |
| `entscheidung` sections | `situation` to `outcome` | `offen` maps to `open` |
| `brett` | store classification | `akteure`, `belege`, `entscheidungen`. An adapter-level property. |
| `traeger`, `zugehoerigkeit` | adapter-level properties | |

The English enumerations for `status`, `visibility` and `classification` are the documented
mapping; the schemas are normative.

## See also

[Glossary](../glossary.md) ·
[Why layers never merge](../explanation/layers-never-merge.md) ·
[Provenance and independence](../explanation/provenance-and-independence.md) ·
[Schemas](https://github.com/Reraise-ai/reraise-app/tree/main/schemas)
