---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0035: Level 1 is a generic engine socket that predicts each player's next move

## Context and Problem Statement

[ADR-0015](0015-two-thinking-levels.md) introduced level 1 as a fast, typed answer to a
question with closed options, delivered by a `ModelConnector` with a Jev connector as the
prominent cloud engine. The owner has since decided (2026-10-06) what level 1 is for and how
it is integrated:

- Level 1 is a generic **engine socket**, not a Jev integration. Jev is one adapter among
  several (imitators exist); a local engine is the default.
- Purpose: when the user sets or changes an assumption on the board, the engine quickly
  predicts, per player, the most likely next move, based only on the cards on the board
  (interests, capabilities, dependencies, past moves, statements against behaviour, red lines,
  assumed goals) and the user's rules.
- Output per player: the move options as a closed set, the predicted move, a calibrated
  confidence and the ids of the cards used. The board shows "`<engine>` estimates ..." next to
  each player, never a verdict. It re-runs automatically when an assumption changes (what-if)
  and any prediction can be escalated to a level-2 board analysis.
- Cloud engines receive gate-cleared cards only, with per-transfer confirmation.
- The implementation slice comes right after M1 and must not block it.

Which contract does the socket have, and what happens to the level-1 part of ADR-0015?

## Decision Drivers

- Any engine must be pluggable without changing the board or the service (Jev, imitators,
  local models, a local rules engine).
- No verdicts ([ADR-0013](0013-rules-panel-replaces-barometer.md)); attribution and the cards
  used are always shown.
- Cloud engines only behind the disclosure gate with hash-bound confirmation
  ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)).
- The engine output must be checkable mechanically: the predicted move is one of the options,
  only cards the engine received are named.
- Minimal: one level-1 contract, not two.

## Considered Options

- Keep `ModelConnector.decide` with the generic question/options answer of ADR-0015 and model
  each player as a separate question
- A dedicated `Level1Engine` port with a per-player prediction contract that replaces the
  level-1 part of `ModelConnector` (chosen)
- A Jev-shaped connector (`POST /v1/decide` with a caller-defined output schema) as the
  internal contract

## Decision Outcome

Chosen option: "A dedicated `Level1Engine` port with a per-player prediction contract",
because the owner's purpose is a prediction per player from one board, which one request per
board expresses directly, and because an engine-neutral port keeps Jev one adapter among
several.

### The socket

- `Level1Engine` in `packages/core/src/adapters/level1.ts`: `engine` (id), `target`
  (`local_model` or `cloud_model`), `deterministic` (boolean) and
  `predict(request, release?) → Level1Prediction`.
- It replaces `ModelConnector.decide`. `ModelConnector` keeps `ask` (level-2 support over a
  context package). The schema `level1-answer.schema.json` (`Level1Answer`, `Level1Request`)
  is removed and replaced by `level1-prediction.schema.json`; the cross-check `level1-choice`
  of [ADR-0028](0028-json-schema-contract-conventions.md) is replaced by `level1-move` and
  `level1-players`. This is a breaking change inside `v0`, which ADR-0028 allows with an ADR.
- Jev is one adapter implementing `Level1Engine` with target `cloud_model`. Its wire format
  (`POST /v1/decide` with an output schema) stays inside the adapter: the adapter builds the
  output schema from the request (`predictedMove` as the enum of `moveOptions`, `confidence`,
  `cardIds`) and maps the answer back. The Jev interface itself remains an owner decision
  (OD-4 of the [architecture documentation](../architecture/09-decisions.md)).
- The default engine is a local engine (`target: local_model`). It must be `deterministic`:
  the same request yields the same prediction, apart from `predictedAt`. It is built in the
  level-1 slice after M1; M1 ships only the contract, the conformance kit and a trivial fake.

### Request and prediction

`schemas/level1-prediction.schema.json`:

- `Level1PredictionRequest` (`#/$defs/request`): `lageId`, `question` (the Lage's question),
  `trigger`, `players[]` (`playerCardId`, `moveOptions`) and `cards[]`.
  - "Player" in the owner's wording ("per player (seat)") is read as an actor card on the
    Lage (type `actor`, `person` or `organisation`). The Lage `seats` remain the participants
    at the board (the user and agents, [ADR-0023](0023-core-domain-model.md)) and are not
    predicted. This is an architect interpretation pending owner confirmation (OD-9 in the
    [architecture decisions](../architecture/09-decisions.md)); if the owner means seats, the
    request gains a seat reference and nothing else changes.
  - `moveOptions` is the closed set of at least two moves for that player: the enum of the
    engine's output schema. Who supplies them (the user, the player's `moves`, or an agent
    proposal that the user accepted) is board UX of the level-1 slice.
  - `cards` are the canonical cards on the Lage plus the user's rule cards that apply to it,
    each after the disclosure gate for the engine's target. No stance data, no pending
    proposals, nothing else. For a `cloud_model` engine they are exactly the objects of one
    confirmed transfer (purpose `level1`).
- `Level1Prediction` (the schema root): `engine`, `lageId`, `trigger`, `requestHash`
  (`sha256:` over the RFC 8785 serialisation of the request,
  [ADR-0034](0034-content-hash.md)), `players[]` and `predictedAt`. Each player prediction has
  `playerCardId`, `moveOptions` (echoed), `predictedMove` (one of them), `confidence` in
  [0, 1] (the engine's own calibrated value, not an ICD 203 estimate,
  [ADR-0010](0010-estimative-probability-scale.md)) and `cardIds` (the request cards it used,
  at least the player card).
- A prediction is not a card. It does not count as a decision, triggers no rule, enters no
  statistics and is never shared ([ADR-0036](0036-conclusions-are-private.md)). It is not
  written to a store; the service may keep the latest prediction per Lage in memory.

### What-if re-run

- Triggers: `lage_opened`, `manual`, and `assumption_changed` with the ids of the assumption
  cards (type `assumption`) the user placed, removed or edited on the Lage.
- The board shows a prediction only while its `requestHash` equals the hash of the current
  request; otherwise the prediction is stale and shown as such. Requests are debounced
  (latest wins); a late answer whose hash is no longer current is discarded.
- For a `local_model` engine the service re-runs automatically on every trigger. For a
  `cloud_model` engine any change produces a new request hash and therefore a new transfer:
  the board marks the prediction stale and offers a re-run that needs a new preview and
  confirmation ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)). There is no
  automatic cloud transfer.
- Assumptions of the later non-persisting what-if layer enter the request as cards of type
  `assumption`; how unsaved scenario assumptions get ids is decided in that slice.

### Display and escalation

- Next to each player: "`<engine>` estimates `<confidence>` for `<predictedMove>`" (amended 2026-10-07 on the owner's wording; this ADR first wrote a colon), with the
  cards used one click away. Never "the answer is", never without the engine name.
- Escalation to level 2: from any player prediction the user can open a level-2 board
  analysis: a new Lage (human-only Lage create) whose question asks for that player's next
  move, whose options are the move options, with the cards used placed and a link back to the
  source Lage. Nothing of the prediction is copied as fact.
- World changes an engine suggests arrive as proposals by `agent:<engine>`
  ([ADR-0011](0011-agent-moves-are-proposals.md)).

### Conformance kit

`describeLevel1EngineConformance(name, factory)` in `@worldbuilder/conformance`, with the pure
check `level1PredictionProblems(engine, request, prediction)` that it uses. Every engine must
pass:

- the prediction validates against the schema, names the engine, echoes Lage, trigger, players
  and move options, and carries the request hash;
- every predicted move is one of the player's move options; confidence is in [0, 1];
- every card id named is a card of the request, also when the request carries fewer cards;
- the engine does not change the request;
- an engine that declares `deterministic` returns the same prediction twice;
- a `cloud_model` engine refuses without a release, with a release that misses a request card,
  and with a release whose card was edited after confirmation (content hash differs), and
  predicts with the release of exactly the request's cards.

The engine's release check is a consistency check, not the consent itself: the kit builds
releases of the right shape with `releaseOf`, which an engine cannot tell from genuine ones.
Consent is enforced by the service, which gets the release only from `DisclosureGate.redeem`
(single use, bound to the confirmed envelope hash and to the session or connection) and passes
it unchanged to the engine. The cross-check `level1-players` also checks that every card named
by an `assumption_changed` trigger is an assumption card of the request.

The kit runs in M1 against `createFixedLevel1Engine` (a trivial fake, local and cloud
variants); real engines run it in their own slice.

### Consequences

- Good, because any engine plugs into one port and the board stays engine-agnostic.
- Good, because predictions are self-verifying (`requestHash`, move in options, cards used
  from the request), which keeps estimates attributable and stale ones visible.
- Good, because Jev's wire format cannot leak into the core model.
- Bad, because `level1-answer.schema.json` and `ModelConnector.decide` are removed; nothing
  implemented them yet, so the cost is documentation and fixtures.
- Bad, because cloud engines cannot follow what-if changes automatically; every re-run needs a
  confirmation, by design.
- Neutral: a generic "quick question with options" without players is no longer a level-1
  contract; the rules panel ([ADR-0013](0013-rules-panel-replaces-barometer.md)) and level-2
  boards cover it.

### Confirmation

- `pnpm validate:schemas`: valid and invalid fixtures for the request and the prediction,
  cross-checks `level1-move` and `level1-players` with their own tests.
- `packages/conformance/src/level1-engine.test.ts`: the kit runs against the fake engine
  (local and cloud), and `level1PredictionProblems` is shown to flag a move outside the
  options, a card not on the board, a missing player card, a confidence above 1, changed move
  options, a wrong engine id, a wrong request hash and a missing player.
- The level-1 slice adds the deterministic local engine and runs the kit against it.

## Pros and Cons of the Options

### Keep `ModelConnector.decide`, one question per player

- Good, because no contract change.
- Bad, because a board needs one transfer per player for cloud engines, and the request hash
  of a what-if change no longer describes one prediction.
- Bad, because the cards used are only "inputs", not tied to a player.

### Dedicated `Level1Engine` port with a per-player prediction

- Good, because it matches the owner's purpose one to one and is checkable.
- Bad, because a breaking change inside `v0`.

### Jev-shaped internal contract

- Good, because the Jev adapter becomes trivial.
- Bad, because it ties every engine to one vendor's interface, which the owner explicitly
  rejected, and that interface is not final.

## More Information

- Supersedes in part [ADR-0015](0015-two-thinking-levels.md): the level-1 result shape
  `{engine, options, choice, confidence, inputs[]}`, "engines are `ModelConnector`s" and the
  Jev stub as a `ModelConnector`. The two levels, attribution, the no-verdict rule and
  escalation stay as decided there.
- Supersedes concept v1: nothing beyond ADR-0015.
- Related: [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0012](0012-disclosure-gate.md), [ADR-0028](0028-json-schema-contract-conventions.md),
  [ADR-0031](0031-gate-rules-and-confirmation-binding.md),
  [ADR-0036](0036-conclusions-are-private.md),
  [ADR-0038](0038-player-fields-red-lines-goals-personality.md).
