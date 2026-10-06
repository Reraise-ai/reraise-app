# Glossary

The repository, code and documentation are in English. The product grew out of German
concept work, and German terms still appear in a legacy card store and in the original
definition. This page maps them. Where a German term is a legacy field name in the legacy
card format, the table gives the field of our model that it maps to.

## Domain terms

| German | English (this repository) | Meaning |
| --- | --- | --- |
| Weltenbauer | The Worldbuilder | the product |
| Karte | card | the basic unit of knowledge: a structured, typed element of a world |
| Welt | world | a modelled slice of reality from one perspective. A card appears in several worlds by reference, never by copy. |
| Lage | Lage (situation), `lage` card | a concrete decision situation on the board around one guiding question. Stored as a card with a JSON position block. We keep the German word in the UI and use "situation" in prose. |
| Leitfrage | guiding question | the question every board must have |
| Brett | collection (legacy) | In the owner store `brett` is the collection a card belongs to (`akteure` = `actors`, `belege` = `evidence`, `entscheidungen` = `decisions`), our field `collection`. In our docs "board" means the work surface. Do not confuse the two. |
| Board | board | the central UX where cards become a situation |
| Sitz, Sitze | seat, seats | a participant at the board: `{name, kind: human or agent}` |
| Spieler | player | an actor card shown as a seat with interests, capabilities, dependencies and moves |
| Rote Linien, `rote_linien` | red lines, `redLines` | what an actor has shown or declared it will not accept; a sourced player field ([ADR-0038](./adr/0038-player-fields-red-lines-goals-personality.md)) |
| Angenommene Ziele, `angenommene_ziele` | assumed goals, `assumedGoals` | goals the user assumes an actor (person or organisation) pursues; a sourced player field, private when it cites the user's own assessment |
| Persönlichkeitstyp, `persoenlichkeitstyp` | personality type, `personalityType` | for example an MBTI type of a natural person; one sourced value, always private |
| Zug, Züge | move, moves | an action taken by a player (a player field), or, in the proposal system, a proposed change to the board |
| Strategem | stratagem | one of the 36 Stratagems (Rieck), a thinking tool offered as a proposal, never as a verdict |
| Tür | the door | the owner store's validator. Our equivalent is the JSON Schemas plus the conformance kit. |
| Schreibkanal | write channel | the single sanctioned way of writing cards into the owner store |
| Prämisse | premise | a standing assumption of a world, shown permanently and open to attack |
| Annahme | assumption | an assumption card, such as a premise or a what-if scenario assumption |
| Fremdkörper | foreign body | information that does not fit the model. It stays visible in the tray and is never discarded. |
| Kreislauf | loop | experience, card, world, board, analysis, decision, action, outcome, new experience |
| Kontextpaket | context package | the selection of cards, relations, decisions and provenance handed to a model or agent |
| Entscheidungskarte | decision card | card with the 11 sections |
| Entscheidungsregel | decision rule (Rule) | a rule card evaluated by the Rules panel |
| Neigungsmesser, Barometer | barometer (removed) | the superseded probability meter. Replaced by the Rules panel ([ADR-0013](./adr/0013-rules-panel-replaces-barometer.md)). |
| Freigabe | release | `release`: `private`, `community` or `commercial`. The user's per-card release for sharing; conclusions stay private whatever it says ([ADR-0036](./adr/0036-conclusions-are-private.md)). |
| Schlussfolgerungen | conclusions | everything that originates from the user without a public external source: stances, ratings, own classifications, decisions, rules, AI analysis on the board. Never shared with other people ([ADR-0036](./adr/0036-conclusions-are-private.md)). |
| Sichtbarkeit | visibility | `visibility`: who may see a card. See the values below. |
| Klasse | class | `class` A, B or C: the sensitivity class of a card, an input to disclosure-gate rules |
| Träger | carrier | `carrier`, carried as stored |
| Zugehörigkeit | affiliation | `affiliation`, carried as stored |
| Prüfsumme | source checksum | `sourceChecksum`: SHA-256 of the original source document. Not `contentHash`, which we compute over the canonical card content. |
| Quelle | source | where a statement comes from. As a card type: a source card. |
| Urheber | author | who created the card or edge: `human` or `agent:<name>` |
| Herkunftssystem | origin system | `originSystem`: which system the content came from |
| Fundstelle | location in source | exact place in a source (page, timestamp) |
| Ursprung | origin | the root of a provenance chain. Counters count origins, not cards. |
| Quellen-Pass | source pass | the provenance view and the counter "N findings · M origins" |
| Haltung | stance | the user's private position on a card: `position` (`believed`, `rejected`, `undecided`), `weight`, `note`, history ([ADR-0008](./adr/0008-believed-as-private-stance.md)) |
| Trefferquote | hit accuracy | share of resolved forecasts that came true |
| Quellenprofil | source profile | a multi-dimensional profile of a source. Never a single score. |
| Prognose | forecast | a checkable expectation with a probability and a resolution criterion |
| Ergebnis | outcome | the result of a decision. `open` until known. |
| Nachhalten | follow up (review) | the step that turns a decision and its outcome into experience |
| Geisterkarte | ghost card (superseded) | replaced by the proposal concept ([ADR-0011](./adr/0011-agent-moves-are-proposals.md)) |
| Zeitreise | time travel (time slider) | showing the board as of an earlier date |
| Welt-Kollision | world collision | overlaying two worlds on one question |
| Was-wäre-wenn | what-if | a non-persisting scenario layer |
| Gatekeeper | gatekeeper | an instance controlling what is visible or relevant |
| Schranke | disclosure gate | decides per card and per target whether a card may leave. Default deny. See [ADR-0012](./adr/0012-disclosure-gate.md). |

## Epistemic kinds: layers and stance

| German (legacy `ebene`) | English | Notes |
| --- | --- | --- |
| BELEGT, `belegt` | `layer: evidenced` | traceable to a source or an original. Needs `source` or `originSystem`. |
| GESAGT, `gesagt` | `layer: said` | someone claimed it. Needs `source` or `originSystem`. |
| ERFAHRUNG, `erfahrung` | `layer: experience` | own experience, evidence of its own kind. Needs an `author`. |
| GEGLAUBT, `geglaubt` | `stance.position: believed` | **not a layer.** A private overlay per user per card (`believed`, `rejected`, `undecided`). A legacy `ebene: geglaubt` card maps to `layer: said` with the user as author, plus a believed stance. |

## Edge kinds

| German `art` | English `kind` |
| --- | --- |
| `stuetzt` | `supports` |
| `widerlegt` | `refutes` |
| `vertritt` | `represents` |
| `zitiert` | `cites` |
| `beruht_auf` | `based_on` |
| `abhaengig_von` | `depends_on` |
| `beziehung` | `relation` |
| `unbestimmt` | `unspecified` |

A legacy `verknuepfungen` list reads as edges of kind `unspecified`.

## Card and format fields

The mapping below follows [ADR-0023](./adr/0023-core-domain-model.md), which is normative. The machine-readable values are defined by the JSON Schemas in [`schemas/`](https://github.com/Reraise-ai/reraise-app/tree/main/schemas), which win if they differ.

| German field | English field |
| --- | --- |
| `id` | `externalId`, plus `uri` and the derived canonical `id` |
| `brett` | `collection` |
| `traeger`, `zugehoerigkeit` | `carrier`, `affiliation` |
| `typ` | `type` (original kept in `typeRaw`) |
| `titel` | `title` |
| `datum` | `date` |
| `quelle`, `quelle_datum` | `source`, `sourceDate` |
| `pruefsumme` | `sourceChecksum` |
| `status` (`entwurf`, `geprueft`, `freigegeben`) | `status` (`draft`, `checked`, `released`) |
| `bewertung` | `rating` |
| `freigabe` (`privat`, `community`, `kommerziell`) | `release` (`private`, `community`, `commercial`) |
| `sichtbarkeit` | `visibility` |
| `klasse` | `class` |
| `format` | `format` |
| `ebene` | `layer` |
| `welten` | `worlds` |
| `einordnung` | stance `note` (private, not a card field) |
| `urheber` | `author` |
| `herkunft_system` | `originSystem` |
| `training` (`ja`, `nein`) | `training` (boolean, default false) |
| `kanten` (`ziel\|art\|von`) | `edges` (`{target, kind, by}`) |
| `interessen`, `faehigkeiten`, `abhaengigkeiten`, `zuege` | `interests`, `capabilities`, `dependencies`, `moves` (`{text, source}`) |

Visibility values: `privat` = `private`, `gesellschaftsintern` = `company_internal`,
`partneruebergreifend` = `cross_partner`, `kundensichtbar` = `customer_visible`, `oeffentlich` =
`public`. Collection values (`brett`): `akteure` = `actors`, `belege` = `evidence`,
`entscheidungen` = `decisions`. Author values: `mensch` = `human`; an absent author on a legacy
card is `unknown`.

## Lage fields

| German | English |
| --- | --- |
| `frage` | `question` |
| `optionen` | `options` |
| `karten` | `cards` (`{id, x, y}`) |
| `sitze` (`name`, `art`) | `seats` (`name`, `kind`: `human` or `agent`) |
| `kanten` (`von`, `ziel`, `art`, `wer`) | `edges` (`from`, `to`, `kind`, `by`) |
| `version`, `stand` | `version`, `updatedAt` |
| `Stellung` | position (the JSON block section) |

## Decision card fields

| German section | English field |
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
| Ergebnis (`offen`) | `outcome` (`open`) |

Store headings are matched with and without umlaut transliteration (`ae`, `oe`, `ue`).

## Source profile dimensions

| German | English |
| --- | --- |
| Treffergenauigkeit | `hitAccuracy` |
| Zuverlässigkeit | `reliability` |
| Themenkompetenz | `topicCompetence` |
| Übereinstimmung mit der eigenen Welt | `agreement` |
| Abweichung von der eigenen Welt | `deviation` |
| Qualität der verwendeten Quellen | `sourceQuality` |
| historische Performance | `historicalPerformance` |
| Wert als Gegenperspektive | `counterPerspectiveValue` |

## Other terms

- **Reserved card fields:** `level` (future card tiers, not an epistemic field) and `signature`
  (author signatures). Both are unused.
- **Disclosure targets:** `screen`, `local_model`, `cloud_model`, `demo`, `share`.
- **Thinking levels:** Level 1 (fast, "System 1") and Level 2 (deliberate, "System 2", the board).
- **Proposal kinds:** `place_card`, `move_card`, `add_edge`, `create_card`, `comment`,
  `record_outcome`.
- **Knowledge loop:** an agent consults the knowledge at the start of a task and writes back at
  the end; each step returns a receipt (**Knowledge Receipt**, **Write-back Receipt**) that the
  task hand-off (**task record**) cites and the **receipt log** proves
  ([ADR-0039](./adr/0039-knowledge-loop-receipts.md)).
- **Atlas:** the generated summary pages over the cards that agents use for orientation; every
  line cites card ids ([ADR-0043](./adr/0043-digest-atlas-regeneration.md)).
- **Adapters:** `StorageAdapter`, `SourceConnector`, `ModelConnector`, `Level1Engine`, `DisclosureGate`.
- **ICD 203:** the intelligence-community standard of verbal probability bands used for
  stored probability phrases.
