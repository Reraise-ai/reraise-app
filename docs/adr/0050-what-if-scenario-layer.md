---
status: accepted
date: 2026-10-14
decision-makers: "Owner (product, roadmap what-if slice), builder (contract shape)"
---

# ADR-0050: The what-if layer is not a card

## Context and Problem Statement

The what-if slice ([ADR-0020](0020-build-order-milestones.md)) needs a scenario layer the user
can attach to a decision. The layer must not change a stored card. Where do the assumptions
live, and what does "attached" mean?

## Decision Drivers

- A scenario assumption is not a fact in the world ([board UX](../product/board-ux.md): the
  layer never changes real cards).
- The board is only a client of the Board API (AC-23).
- Until `v0.1.0` a contract change stays in `v0` and needs an ADR
  ([ADR-0028](0028-json-schema-contract-conventions.md)).
- Device-only records stay in the state directory ([ADR-0030](0030-local-state-on-the-device.md)).

## Considered Options

- Write each assumption as an `assumption` card
- Copy the assumption text into one of the decision's eleven sections
- Keep the live layer in memory and copy a snapshot onto the decision in the state directory,
  leaving every card file unchanged (chosen)

## Decision Outcome

Chosen option: "memory for the live layer, a device-local snapshot for the attachment", because
it is the only option that adds assumptions without writing a card.

Four human-only operations, none of them MCP tools:

- `scenario_get` (`GET /lagen/{lageId}/scenario`) returns the live layer. An unknown Lage is 404.
- `scenario_replace` (`PUT /lagen/{lageId}/scenario`) replaces that layer. The body is
  `scenarioReplace`: up to 20 `{ statement }` entries. The service trims each statement, drops
  blanks and repeated statements, and assigns a new ULID per remaining statement. An empty list
  clears the layer. The layer is kept in memory for this process only. A restart drops it.
- `scenario_attach` (`POST /lagen/{lageId}/scenario/attach`) copies the live layer onto a
  decision. The body is `{ decisionId }`. An empty layer is 400. An unknown decision, or a card
  that is not a decision, is 404. The snapshot is `scenario-attachments/<decisionId>.json` in
  the state directory. The decision card is not patched.
- `scenario_attachment_get` (`GET /decisions/{decisionId}/scenario`) reads that snapshot. No
  snapshot is 404.

The assumption id is a ULID and is not a card id. Nothing in this slice places the assumption
in a level-1 request. That join stays for a later change
([ADR-0035](0035-level1-engine-socket.md)).

### Consequences

- Good, because turning the layer on, editing it and attaching it leaves every card hash as it
  was, and a restart still has the attachment.
- Bad, because the live layer does not survive a restart, and a level-1 estimate does not see
  the scenario assumptions yet.

### Confirmation

`services/api/src/contract.test.ts` replaces a layer, checks that no state file and no card hash
changed, attaches it, and reads the snapshot back from a second store on the same directory.
`packages/local-state/src/store.test.ts` checks the file. The board test saves two lines and
attaches them while recording a decision. `services/api/src/security.test.ts` rejects an agent
token.

## Pros and Cons of the Options

### Assumption cards

- Good, because the rest of the board already knows cards.
- Bad, because the layer would then be a stored card, which is the thing this slice forbids.

### Text inside the eleven sections

- Good, because the attachment would travel inside the decision card.
- Bad, because saving the decision would change that card, and the eleven sections are a fixed
  contract ([ADR-0017](0017-decision-card-and-training-export.md)).

### Memory plus a device-local snapshot (chosen)

- Good, because the card store is untouched and the attachment is still there after a restart.
- Bad, because copying the card store without the state directory loses the attachment, the same
  way a stance is lost.

## More Information

- Supersedes concept v1: nothing. The what-if layer was already mapped to this slice.
- Related: [ADR-0006](0006-files-are-the-truth.md), [ADR-0030](0030-local-state-on-the-device.md),
  [ADR-0035](0035-level1-engine-socket.md).
