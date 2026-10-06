---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0015: Two thinking levels: fast typed answers and the board

## Context and Problem Statement

The owner requires a fast "level 1" thinker (System 1) alongside the
deliberate board (System 2). Level 1 gives a typed, schema-bound quick
decision in milliseconds to seconds from the active world's rules and
cards. It must work locally and through a connector to Jev, an external
"System One Model" service (`POST /v1/decide`: caller defines an output
schema, sends unstructured state, gets a typed answer with calibrated
confidence). Jev is cloud-only and its interface for us is still to be
defined by the owner. How do both levels fit without level 1 becoming an
oracle?

## Decision Drivers

- Level 1 is a must-have.
- No verdicts by the system ([ADR-0013](0013-rules-panel-replaces-barometer.md)).
- Cloud engines only behind the disclosure gate.
- Jev's interface is not final; we must not block on it.

## Considered Options

- Board only (level 2), no fast path
- Fast answer shown as the system's recommendation
- Two explicit levels; level-1 answers are attributed estimates that can
  be escalated to a board (chosen)

## Decision Outcome

Chosen option: "Two explicit levels", because it delivers speed without
letting a fast answer pose as the user's or the system's judgement.

- Level 1 result: `{engine, options (enum), choice, confidence, inputs[]}`,
  validated against a schema. `inputs[]` lists the card ids and rules the
  engine received.
- Engines are `ModelConnector`s: the local rules engine, a local model,
  and Jev. The Jev connector is a stub in M0–M1 implementing the
  documented request/response shape, always behind the disclosure gate as
  target `cloud_model` with per-transfer confirmation
  ([ADR-0012](0012-disclosure-gate.md)).
- UI wording: "`<engine>` estimates 0.82 for X", with its inputs; never "the
  answer is X". The engine's confidence is the engine's own output and is
  shown attributed; it is not an ICD 203 estimate by a source
  ([ADR-0010](0010-estimative-probability-scale.md)).
- Any level-1 answer can be escalated to a level-2 board: a new Lage with
  the question, the options and the input cards placed.
- Level-1 answers do not count as decisions, do not trigger rules and do
  not enter statistics; world changes they imply are proposals (kinds
  `create_card`, `add_edge`, `place_card` or `comment`) with
  `author: agent:<engine-name>` ([ADR-0011](0011-agent-moves-are-proposals.md)).

### Consequences

- Good, because quick checks are possible without opening a board.
- Good, because the Jev integration can land later behind a stable
  connector contract.
- Bad, because two interaction modes to design and explain.
- Bad, because a numeric confidence is visible, which users may still read
  as a verdict; attribution and inputs mitigate this.

### Confirmation

Schema test for the level-1 result; connector contract test for the Jev
stub; gate test that the Jev connector is denied without confirmation.

## Pros and Cons of the Options

### Board only

- Good, because no verdict risk.
- Bad, because misses an owner must-have.

### Fast answer as recommendation

- Good, because simplest UX.
- Bad, because contradicts the no-verdict canon.

### Two explicit levels

- Good, because speed with attribution and an escalation path.
- Bad, because more UI.

## More Information

- Supersedes concept v1: nothing directly (concept v1 had no fast level);
  it extends the "Was würde ich tun?" idea of `docs/02-ux-board.md` §7.
- Related: [ADR-0005](0005-universal-adapter-architecture.md),
  [ADR-0012](0012-disclosure-gate.md),
  [ADR-0013](0013-rules-panel-replaces-barometer.md).
