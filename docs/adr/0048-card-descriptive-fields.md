---
status: accepted
date: 2026-10-10
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0048: Optional descriptive card fields stay out of the hash and out of shares

## Context and Problem Statement

A card can now say which language its `title` and `body` are in, the period in which its
statement applies, other names for its subject, and where the same thing lives in the owner's
other systems. The card format stays v2 (`format: 2`). How are these four fields added so that
existing cards stay valid, their content hashes stay the same, and a pointer into a private
system never leaves the device?

## Decision Drivers

- Existing cards stay valid. No migration, no new format number.
- Hashes of existing cards must not change ([ADR-0034](0034-content-hash.md)).
- `refs` names the owner's private systems and must never leave the device.
- `validUntil` must not be earlier than `validFrom`. JSON Schema cannot compare the two dates.
- The legacy German format has no equivalents. Do not invent legacy names
  ([ADR-0023](0023-core-domain-model.md)).

## Considered Options

- A new format version that requires the fields
- Optional fields on format v2, excluded from the content hash and from the share projection (chosen)
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
2. **Sharing.** None of the four is part of the share projection or of `shared-card.schema.json`.
   `refs` must never leave the device. Sharing `language` and the validity period later is a
   possible follow-up; it is not built here. `refs` stays private.
3. **Validity period.** `validUntil` must not be earlier than `validFrom`. Equal dates are
   allowed. `validityPeriodError` in `@worldbuilder/core` is the rule. The schema cross-check
   `validity-period` walks every object and reports it. Storage adapters reject a create or a
   patch that would store an inverted period, so the card is not written.
4. **Legacy names.** The legacy format has no equivalents. The mapping tables say so and do
   not invent German field names.

Further consequences of the same choice:

- The fields do not join `FORMAT_2_FIELDS`. Like `tags`, they do not turn a legacy card into
  a format-2 card and do not impose format-2 author or layer rules.
- A new markdown-files card writes them in a stable order: `language` and `aliases` after
  `title`, `validFrom` and `validUntil` after `date`, `refs` after `originSystem`. Ref object
  keys are written `system`, then `id`, then `url`, omitting an absent end.
- `refs.id` is not a card id. `referencedIds` does not follow it.
- The fields are not added as properties of context packages or disclosure transfers. A card
  embedded in those envelopes still carries whatever the copy kept.
- Any copy of a whole card that can leave the device drops `refs` and nothing else of these
  four: the cloud disclosure preview (and therefore confirm, redeem and a cloud context
  package), the level-1 envelope (`level1EnvelopeFor`, so its hash matches the preview), and
  the training export. Screen and `local_model` copies stay on the device and keep `refs`.
  The user confirms the stripped cloud preview, so the confirmed hash is the hash of what
  actually leaves ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)).
- `language`, the validity period and `aliases` may remain on a cloud card copy. They are
  still absent from the share projection.

### Consequences

- Good, because existing cards stay valid and their hashes do not change.
- Good, because a private system pointer cannot ride out on a cloud transfer or a training export.
- Good, because an inverted period is rejected before it is stored.
- Bad, because `language` and the validity period are not yet shareable. That follow-up needs
  its own decision; `refs` is not part of it.
- Bad, because a cloud copy of a card is not byte-identical to the stored card: `refs` is gone.
  The copy stays schema-valid, because the field is optional.

### Confirmation

- Schema fixtures: one valid card with all four fields; invalid language tag, empty alias,
  duplicate alias, ref without `id` and `url`, ref with an unknown property; inverted period
  expected as the cross-check `validity-period`.
- `packages/core/src/content-hash.test.ts`: adding any of the four leaves `contentHash` unchanged.
- `packages/core/src/sharing.test.ts`: the share projection of a card with all four contains none.
- `packages/core/src/card-descriptive.test.ts`: period order and `withoutPrivateRefs`.
- Conformance kit: round trip of all four, either end alone, equal dates, hash unchanged, inverted
  create and patch rejected.
- Codec test: stable front-matter order, and `refs.id` is not a referenced card id.
- Disclosure-gate, level-1 envelope and training-export tests: `refs` is absent from the copy
  that can leave, and the caller's card is unchanged.

## Pros and Cons of the Options

### A new format version

- Good, because a reader can see at a glance that the fields exist.
- Bad, because every existing card would need a migration, which this change does not justify.

### Optional fields on format v2 (chosen)

- Good, because the format number stays 2 and cards without the fields stay valid.
- Good, because the hash and the share projection stay stable for cards that do not use them,
  and for cards that do.
- Bad, because readers that ignore unknown fields will not show them until they are updated.
  The reference adapter and the generated types do know them.

### A sidecar file for refs

- Good, because the card file would not mention private systems at all.
- Bad, because a second file can drift from the card, and the other three fields would still
  need a home on the card. One optional field with a hard egress rule is simpler.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0023](0023-core-domain-model.md), [ADR-0028](0028-json-schema-contract-conventions.md),
  [ADR-0031](0031-gate-rules-and-confirmation-binding.md),
  [ADR-0034](0034-content-hash.md), [ADR-0036](0036-conclusions-are-private.md).
- Follow-up, not built: sharing `language` and the validity period. `refs` is not a candidate.
