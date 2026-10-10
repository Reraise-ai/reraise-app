---
status: accepted
date: 2026-10-10
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0048: Optional descriptive card fields stay out of the hash and follow the card's disclosure rules

> Corrected in place on 2026-10-10, before this ADR was released. The first text of the same
> day said that `refs` never leaves the device and that none of the four fields is shared.
> The owner restated the rule the same day. The sections below are that corrected decision.

## Context and Problem Statement

A card can now say which language its `title` and `body` are in, the period in which its
statement applies, other names for its subject, and where the same thing lives in the owner's
other systems. The card format stays v2 (`format: 2`). How are these four fields added so that
existing cards stay valid, their content hashes stay the same, and a copy of a card follows
the same disclosure rules as the rest of the card?

## Decision Drivers

- Existing cards stay valid. No migration, no new format number.
- Hashes of existing cards must not change ([ADR-0034](0034-content-hash.md)).
- The owner's own cloud agent gets an allowed card as it is. The lock is the gate, not a
  per-field rule.
- Sharing with other people depends on whether the information is public and can be pointed
  to, not on the kind of field ([ADR-0036](0036-conclusions-are-private.md)).
- `validUntil` must not be earlier than `validFrom`. JSON Schema cannot compare the two dates.
- The legacy German format has no equivalents. Do not invent legacy names
  ([ADR-0023](0023-core-domain-model.md)).

## Considered Options

- A new format version that requires the fields
- Optional fields on format v2, excluded from the content hash, and disclosed like the rest of
  the card (chosen)
- A sidecar file for `refs`, with the other three on the card

## Decision Outcome

Chosen option: "Optional fields on format v2", because the change is purely additive and the
four fields are descriptive metadata, not the information the card states.

| Field | Shape | Meaning |
| --- | --- | --- |
| `language` | BCP 47 language tag (`common.schema.json` `$defs/languageTag`) | Language of `title` and `body`. Well-formed RFC 5646 tags only (`de`, `en`, `es-AR`, `zh-Hans`). Grandfathered irregular tags such as `i-enochian` are not accepted. |
| `validFrom`, `validUntil` | ISO date, the same type as `date` and `sourceDate` | Period in which the statement applies, inclusive. Distinct from `date` (when it happened) and `sourceDate` (when the source said it). Either end may stand alone. |
| `aliases` | array of unique non-empty strings, at least one item when present | Other names for the subject: spellings, former names, abbreviations. |
| `refs` | array of unique `{ system, id?, url? }`, no other properties, at least one item when present | Pointers to the same thing in other systems. `system` matches `^[a-z0-9][a-z0-9._-]*$`. `id` is non-empty text and is not a card id. `url` is a URI. At least one of `id` and `url` is required. |

Decisions already taken, recorded here:

1. **Content hash.** None of the four fields enters `contentHash`. They are not added to
   `CONTENT_HASH_FIELDS`. Adding any of them to an existing card leaves the hash unchanged.
2. **The owner's own cloud agent.** When the disclosure gate allows a card for a cloud
   target, the card goes as it is. `language`, `validFrom`, `validUntil`, `aliases` and
   `refs` are not stripped from a cloud preview, the release of that preview, a level-1
   envelope, a training export, or any other card copy for the owner's own models and
   agents. Whoever wants nothing in the cloud uses the existing lock. That is the gate's
   job. What the user confirms is exactly what is sent
   ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)).
3. **Sharing with other people.** Whether something may be shared does not depend on the
   kind of field. It depends on whether it is public information one can point to. The
   share projection already keeps `source` only as a public http or https address
   (`isPublicSourceUri`). The same principle applies to the four fields. `language`,
   `validFrom`, `validUntil` and `aliases` travel with a card that is shared. A `refs`
   entry is kept only when it has a public `url` under that same rule, and the entry then
   keeps `system`, `id` and `url`. An entry without a public `url` (an id only, or a
   non-public address) is dropped. If no entry remains, the shared card has no `refs`.
   There is one definition of a public address; the projection reuses it.
4. **Validity period.** `validUntil` must not be earlier than `validFrom`. Equal dates are
   allowed. `validityPeriodError` in `@worldbuilder/core` is the rule. The schema cross-check
   `validity-period` walks every object and reports it. Storage adapters reject a create or a
   patch that would store an inverted period, so the card is not written.
5. **Legacy names.** The legacy format has no equivalents. The mapping tables say so and do
   not invent German field names.

Further consequences of the same choice:

- The fields do not join `FORMAT_2_FIELDS`. Like `tags`, they do not turn a legacy card into
  a card of format 2 and do not impose format-2 author or layer rules.
- A new markdown-files card writes them in a stable order: `language` and `aliases` after
  `title`, `validFrom` and `validUntil` after `date`, `refs` after `originSystem`. Ref object
  keys are written `system`, then `id`, then `url`, omitting an absent end.
- `refs.id` is not a card id. `referencedIds` does not follow it.
- The fields are not separate properties of a context package or a disclosure transfer. A
  card embedded in those envelopes carries whatever that copy kept.
- The training export treats the four fields the way it already treats other non-hashed
  card metadata: it keeps them. It still drops a card that names a card which did not opt
  in, and that walk reads every string outside `worlds`, including a `refs.id` that happens
  to be a card id.
- The System One HTTP adapter still renders a released card as text from a fixed list of
  content lines. That text is not a card copy. The confirmed level-1 envelope holds the
  cards themselves, including `refs`.

### Consequences

- Good, because existing cards stay valid and their hashes do not change.
- Good, because the lock stays the only control on what reaches the owner's own cloud agent,
  and the confirmed envelope is the envelope that is sent.
- Good, because a share can carry a public page, a language, a period and a public alias
  without a special case per field, and a private pointer does not ride along.
- Good, because an inverted period is rejected before it is stored.
- Neutral, because a shared card can list fewer `refs` than the stored card. The stored card
  is unchanged.
- Bad, because readers that ignore unknown fields will not show the four fields until they
  are updated. The reference adapter and the generated types do know them.

### Confirmation

- Schema fixtures: one valid card with all four fields; one valid shared card with all four
  and a public `refs` url; invalid language tag, empty alias, duplicate alias, ref without
  `id` and `url`, ref with an unknown property; a shared `refs` entry whose url is not a
  public address; inverted period expected as the cross-check `validity-period`.
- `packages/core/src/content-hash.test.ts`: adding any of the four leaves `contentHash` unchanged.
- `packages/core/src/sharing.test.ts`: `language`, the validity period and `aliases` travel;
  a `refs` entry travels only with a public url, and `refs` is omitted when none remain.
- `packages/core/src/card-descriptive.test.ts`: period order.
- Conformance kit: round trip of all four, either end alone, equal dates, hash unchanged,
  inverted create and patch rejected. A cloud preview and its release contain the card's
  `refs`. A share carries the descriptive fields and only the public `refs` entries.
- Codec test: stable front-matter order, and `refs.id` is not a referenced card id.
- Disclosure-gate, level-1 envelope and training-export tests: `refs` is present on the
  owner's own copy, and the caller's stored card is unchanged.

## Pros and Cons of the Options

### A new format version

- Good, because a reader can see at a glance that the fields exist.
- Bad, because every existing card would need a migration, which this change does not justify.

### Optional fields on format v2 (chosen)

- Good, because the format number stays 2 and cards without the fields stay valid.
- Good, because the hash stays the same whether or not a card uses the fields.
- Bad, because readers that ignore unknown fields will not show them until they are updated.
  The reference adapter and the generated types do know them.

### A sidecar file for refs

- Good, because the card file would not mention other systems at all.
- Bad, because a second file can drift from the card, and the other three fields would still
  need a home on the card. One optional field on the card is simpler.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0023](0023-core-domain-model.md), [ADR-0028](0028-json-schema-contract-conventions.md),
  [ADR-0031](0031-gate-rules-and-confirmation-binding.md),
  [ADR-0034](0034-content-hash.md), [ADR-0036](0036-conclusions-are-private.md).
- The two disclosure rules above are this decision. They are not a later follow-up.
