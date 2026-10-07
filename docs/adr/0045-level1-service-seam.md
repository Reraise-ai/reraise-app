---
status: accepted
date: 2026-10-07
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0045: Level 1 in the service: human-only operations, the transfer flow and an in-memory latest prediction

## Context and Problem Statement

[ADR-0035](0035-level1-engine-socket.md) defines the `Level1Engine` socket and the engines of
`@worldbuilder/level1-engines` implement it. Nothing yet says how the service builds the request
from a Lage, which operations the board calls, how a cloud engine goes through the confirmation
of [ADR-0031](0031-gate-rules-and-confirmation-binding.md), where cloud engines are configured,
and what the service keeps. These choices decide what leaves the device, so they are recorded
here rather than left to the code.

## Decision Drivers

- A prediction is the human's own request: not an MCP tool, never an agent write path
  ([ADR-0011](0011-agent-moves-are-proposals.md)).
- A cloud engine receives exactly the confirmed objects and nothing else, with no automatic
  transfer ([ADR-0031](0031-gate-rules-and-confirmation-binding.md), ADR-0035).
- A prediction is not a card and never reaches a store, the gate log or a context package
  ([ADR-0035](0035-level1-engine-socket.md), [ADR-0036](0036-conclusions-are-private.md)).
- A late or outdated answer must never be shown as current.
- The default must work offline, with no configuration.

## Considered Options

- Expose `level1_predict` as an MCP tool as well
- Human-only operations on the Board API; the confirmation reuses the existing preview and
  confirm operations (chosen)
- A new confirmation operation of its own for level 1

## Decision Outcome

Chosen option: "Human-only operations on the Board API, reusing preview and confirm", because
the confirmation binding already exists and is tested, and a second one would be a second place
to get it wrong.

### Operations

All three are `x-human-only` with the session token only, so none is an MCP tool (the parity test
lists them among the human-only operations).

- `level1_get` (`GET /lagen/{lageId}/level1`): the engines on offer and the latest prediction of
  the Lage with `stale`; `explain=true` adds the basis of the local engine for the current board.
  This operation is an addition to the two the slice was planned with: the board needs the
  staleness after every edit, and only the service can compute the request hash.
- `level1_predict` (`POST /lagen/{lageId}/level1`): body `{ engine, trigger, transferId?,
  confirmationToken? }`; answers `Level1Result` with the status `predicted`,
  `confirmation_required`, `no_players` or `superseded`.
- `level1_escalate` (`POST /lagen/{lageId}/level1/escalate`): body `{ playerCardId }`; creates the
  level-2 Lage from `buildLevel2Draft` (same path and result as `lage_create`) and gives the new
  Lage card a `based_on` edge to the source Lage, drawn by the human. It needs a current
  prediction of the Lage (409 otherwise).

### The request

- Players are the actor, person and organisation cards placed on the Lage (as in ADR-0035); their
  move options are `buildMoveOptions` of the engine package (past moves, the actions of the rule
  cards, a "no new action" fallback). A Lage with no player answers `no_players`.
- Cards: the cards placed on the Lage, then the user's rule cards that apply to it (no `worlds`, or
  a world in common with the Lage; at most 50, ordered by id). Each is cleared by the gate for the
  engine's target. Never a stance, never a pending proposal.
- The built-in `local` engine (`local-rules`) runs inside the service process, has no network and
  cannot send anything. It is therefore cleared as the screen: the same cards the board shows.
  A model engine that runs elsewhere would be cleared for `local_model`; none exists yet. A cloud
  engine is cleared for `cloud_model`: a card counts if the rules would clear it after a confirmed
  transfer (`GateService.clears`), and the preview leaves out the others.
- An assumption card (type `assumption`) the user has rejected (its stance, read locally) is left
  out of the request. This is what makes "the user changes an assumption" change the request: a
  stance never leaves the device, only the card's absence does, and it does not say why the card
  is absent. Undecided and believed assumptions stay in.
- A trigger `assumption_changed` keeps the ids that are assumption cards of the request; if none
  is left (the card was removed or rejected) the service records `manual`, as the schema requires
  the named cards to be on the board.

### Cloud engines and the transfer flow

- Cloud engines are configured in `<state>/level1-engines.yaml` (`schemas/level1-engines.schema.json`);
  there is none by default and the file does not exist until the user creates it. An entry has an
  id, a preset (`generic` or `jev`), an https base URL, `enabled` and optionally the path of an
  owner-only credential file; no credential is stored in the file. An invalid file, a credential
  file readable by others, or an id that is `local`, `local-rules` or a registered agent name
  means no cloud engine is available and the reason is shown (fail closed).
- The Jev preset is listed as `jev`, unavailable ("not configured"), until the file has an enabled
  entry for it. Its wire format stays unconfirmed (owner decision OD-4).
- First call, no `transferId`: the service builds the request, the envelope
  (`level1EnvelopeFor`) and previews it as a transfer with purpose `level1` and the engine as
  connector, and answers `confirmation_required` with the transfer, whose envelope the board shows
  in full. Nothing is sent.
- The human confirms with the existing `disclosure_confirm` and receives the single-use token.
- Second call, with `transferId` and `confirmationToken`: the service rebuilds the request from the
  store. If the rebuilt envelope hash differs from the transfer's (a card, the question or the
  options changed), it answers 409 and consumes nothing: preview again. Otherwise it redeems the
  token once and passes the release unchanged to `engine.predict`. The engine refuses any release
  that is not bound to its own envelope. An engine failure is a 502 with fixed wording; the
  answer text, the credential and the address never appear in an error, the log or the gate log.
- There is no automatic cloud re-run: a changed board makes the prediction stale and the board
  offers a new preview.

### What the service keeps

- The latest prediction per Lage, in memory (at most 200 Lagen, the least recently used is
  dropped), lost at a restart. Never written to a card, a store, the gate log or a context
  package; the gate log keeps its content-free lines only.
- Latest wins: every call takes a sequence number per Lage. When the engine answers, the service
  rebuilds the request; a prediction is stored and returned only if no later call started and
  `currentOnly` still accepts it. Otherwise the result is `superseded` and nothing is stored.
- Staleness is `isStale` (the request hash with the trigger left out, `stalenessKey`), computed on
  every `level1_get` against the board as it is now. A local re-run for `assumption_changed` that
  finds the stored prediction still current does not run the engine (`rerunOnAssumptionChange`).

### Consequences

- Good, because the confirmation path is the one already proven; a cloud prediction cannot be
  sent without the human seeing the whole envelope.
- Good, because nothing about a prediction persists beyond the process.
- Bad, because the board must ask for the staleness after each change (a cheap local call).
- Bad, because omitting a rejected assumption shows, to a cloud engine, that the card is not
  there; it is the user's own choice and is visible in the previewed envelope.
- Neutral: three operations instead of two (see `level1_get`).

### Confirmation

Service tests (`services/api/src/level1.test.ts`): a cloud engine is refused without a release
and sends nothing; the preview shows the whole envelope; a confirmed transfer is spent once; a
change after the preview is a 409 that consumes nothing; the local engine is deterministic;
an assumption change makes the prediction stale and a rejected assumption changes the request;
a late answer is dropped; no stance, proposal or prediction reaches the cards or the gate log;
the three operations answer 403 to an agent token and are not MCP tools. Schema fixtures cover
the request, the result, the state and the engine registry.

## Pros and Cons of the Options

### `level1_predict` as an MCP tool as well

- Good, because agents could ask for estimates.
- Bad, because an estimate from the user's private cards is a conclusion about the user's board
  (ADR-0036) and a cloud engine call needs the human at the confirmation anyway.

### Human-only operations reusing preview and confirm

- Good, because no second confirmation binding.
- Bad, because the board makes two calls for a cloud estimate.

### A level-1 confirmation operation

- Good, because one call shape.
- Bad, because duplicates the binding of ADR-0031.

## More Information

- Related: [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0030](0030-local-state-on-the-device.md),
  [ADR-0031](0031-gate-rules-and-confirmation-binding.md),
  [ADR-0035](0035-level1-engine-socket.md), [ADR-0036](0036-conclusions-are-private.md).
- Owner questions with the defaults taken: OQ-23 to OQ-27 in [owner-questions](../owner-questions.md).
