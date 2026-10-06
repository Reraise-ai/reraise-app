---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0008: "Believed" is a private stance overlay, never a fourth layer

## Context and Problem Statement

The canon distinguishes evidenced, said and believed. A belief is not a
property of a statement but the user's relation to it: the same said card
can be believed by one person and rejected by another. The owner's card
format v2 nevertheless allows `ebene: geglaubt` on a card, and concept v1
modelled a stance with agreement −2..+2 plus confidence 0–100 %. The owner
also ruled that the user's stances and conclusions never leave the device.

## Decision Drivers

- Never merge the user's belief into the knowledge itself.
- Stances are the most private data; they must not reach any model or
  other user.
- Only humans hold beliefs; agents must not set them.
- Existing owner cards with `ebene: geglaubt` must map without loss.

## Considered Options

- `believed` as a fourth `layer` value (as in card format v2)
- Stance overlay with agreement −2..+2 and confidence 0–100 % (concept v1)
- Stance overlay with a position, weight and note (chosen)

## Decision Outcome

Chosen option: "Stance overlay with a position, weight and note", because
it keeps belief out of the card, is simple enough to set in one gesture,
and maps the legacy value cleanly.

- `Stance` = one per user per card: `cardId`, `position ∈ {believed,
  rejected, undecided}`, `weight` (strength with which the position is
  held; range fixed in the Stance schema), `note`, `updatedAt`. Every
  change keeps the previous version (history), never overwrites.
- Only a human sets a stance. No MCP tool, agent endpoint or proposal kind
  can create or change one ([ADR-0011](0011-agent-moves-are-proposals.md)).
- Stances never leave the device: the disclosure gate allows them only for
  target `screen` ([ADR-0012](0012-disclosure-gate.md)); context packages
  for any model, demos, exports and shared cards never contain them.
- Legacy mapping (implemented by the owner's adapter, rule tested by
  `packages/conformance`): a card with `ebene: geglaubt` becomes
  `layer: said` with `author` = the user, plus a stance `position:
  believed` for that user.
- Experience is a layer, not a stance; it is never shown as "believed".

### Consequences

- Good, because the board can show "said by X" and "believed by me" side
  by side without blending them.
- Good, because privacy is structural: stances are not in the card, so
  sharing or sending a card cannot leak them.
- Bad, because the agreement and confidence nuance of concept v1 is
  reduced to position plus weight; source-profile dimensions that compare
  the source with the user's world use the position.
- Bad, because stances need storage on the user's device separate from
  shared card storage.

### Confirmation

Schema tests for `Stance`; conformance test for the `geglaubt` mapping;
disclosure-gate tests that a stance is denied for every target except
`screen`; MCP contract has no stance-writing tool.

## Pros and Cons of the Options

### `believed` as a fourth layer

- Good, because identical to card format v2.
- Bad, because a belief becomes a property of knowledge and travels with
  the card when shared or sent to a model.

### Agreement −2..+2 and confidence 0–100 %

- Good, because expressive; separates "unsure" from "undecided".
- Bad, because two numbers per card slow down the board and invite false
  precision.

### Position, weight and note

- Good, because simple, private and mappable.
- Bad, because less granular.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §5.2 (`Agreement`
  −2..+2, `confidence` 0..100, `visibility: 'shared'` for stances),
  `docs/02-ux-board.md` §2.1 stance bar, `docs/05-roadmap.md` §4 open
  decision 4 (stance scale), `myStance` in context packages and the
  `privacy: no-stances` option (`docs/04-architektur.md` §6–§7).
- Related: [ADR-0007](0007-epistemic-layer-field.md),
  [ADR-0012](0012-disclosure-gate.md),
  [ADR-0021](0021-privacy-and-sharing-model.md).
