---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0036: Conclusions are private; a `share` target enforces it in the disclosure gate

## Context and Problem Statement

[ADR-0021](0021-privacy-and-sharing-model.md) and [ADR-0012](0012-disclosure-gate.md) read the
owner's word "conclusions" as stance data only, pending owner confirmation (open decision
OD-7). The owner has now ruled (2026-10-06):

- Everything that originates from the user without an external public source is private and
  never shareable with other people: stances, ratings, own classifications, decision cards,
  rules, and any AI analysis produced on the user's board.
- The user's own experience cards are private by default and can be released by the user card
  by card.
- Only cards with a public external source are shareable, and only their content and
  provenance.
- Clarification: decision and rule cards may go to a cloud model with per-transfer
  confirmation, never to other people.

The gate has no target for "other people" yet, and no rule decides what counts as
user-originated. How is this enforced so that no rule, no adapter and no agent can widen it?

## Decision Drivers

- The rule is a hard ceiling: not configurable, not widenable by gate rules or adapters.
- Fail closed: whatever cannot be shown to rest on a public external source is private.
- Sharing is irreversible; it must be explicit per card.
- Models are not "other people": the cloud rules of [ADR-0031](0031-gate-rules-and-confirmation-binding.md)
  stay as they are.
- No sharing feature exists in this phase ([ADR-0021](0021-privacy-and-sharing-model.md));
  the contract must hold now and constrain the later platform.

## Considered Options

- Treat `demo` or `cloud_model` semantics as "sharing"
- A stored per-card field `origin: user | external`
- A new gate target `share` with an origin class derived from canonical fields, plus the
  existing `release` field as the user's per-card release (chosen)

## Decision Outcome

Chosen option: "a new gate target `share` with a derived origin class and `release` as the
per-card release", because it puts the owner's rule into the one component every egress
already passes, needs no new stored field that stores or agents could set wrongly, and reuses
the field the owner's card format already has for release (`freigabe`).

### Target

- `DisclosureTarget` gains `share`: anything that goes to other people (another user, a
  peer-to-peer exchange, a platform export). Gate rules may name it in `targets`.
- Context packages and rule evaluations are never built for `share`: their schemas use the new
  `PackageTarget` (`screen`, `local_model`, `cloud_model`, `demo`).
- Stance data stays `screen` only ([ADR-0008](0008-believed-as-private-stance.md)); this
  includes `share`.

### Origin classes

`originOf(card)` in `packages/core` derives one class from canonical fields, in this order,
first match wins:

| Class | When | `share` |
| --- | --- | --- |
| `conclusion` | `type` is `decision`, `rule`, `rating` (own assessment), `assumption` or `lage` | never |
| `conclusion` | `author` is `agent:<name>` (AI output on the user's board) or not `human` (unknown) | never |
| `experience` | `layer: experience` or `type: experience`, by the human | only after release |
| `conclusion` | no `layer` (unclassified) | never |
| `conclusion` | `source` is not a public `http(s)` address (free text, a card id, a `wb:` URI, a local or IP host) | never |
| `external` | a human card with layer `evidenced` or `said` and a public `http(s)` source | only after release |

- Own classifications (`einordnung`) are stance notes already
  ([ADR-0023](0023-core-domain-model.md)) and never a card field.
- Level-1 predictions, model answers, rule evaluations and proposals are not cards; no share
  path accepts them. Accepted agent cards are `conclusion` because of their author.
- The class is derived, not stored: there is no field an adapter or an agent could set to
  make a card shareable.

### Enforcement in the gate

`decide(card, 'share')`, in this order:

1. stance data: deny;
2. origin class `conclusion`: deny, reason "conclusions are never shared: ..."; no rule, no
   adapter fragment and no release can change this;
3. `release` absent or `private`: deny, reason "not released for sharing by the user";
4. otherwise the normal rule evaluation for target `share`: default deny, deny wins
   ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)).

The per-card release is the existing `release` field (`community` or `commercial`, owner key
`freigabe`). The user changes it only through the human-only card edit path; an agent cannot:
a `create_card` proposal may carry `release` only as `private`, and no proposal kind patches a
card. External-source cards need the release too, not only experience cards. This is stricter
than the owner's wording and an architect interpretation: it keeps "users explicitly unlock
what they share" of ADR-0021 and closes the gap where an own assessment written as a claim
cites the article it assesses.

### What a share carries

- `DisclosureGate.prepareShare(cards)` returns a `ShareBundle`: the share projections of the
  allowed cards and the ids and reasons of the others. It sends nothing.
- The share projection (`shareProjection` in `packages/core`, schema
  `shared-card.schema.json`, type `SharedCard`) holds content and provenance only:
  `id`, `format`, `collection`, `type`, `title`, `body`, `date`, `layer`, `source`,
  `sourceDate`, `sourceChecksum`, `originSystem`, `author` (always `human`), and the player
  entries whose source is a public `http(s)` address. It never holds the store identity
  (`uri`, `externalId`), `worlds`, `tags`, `class`, `visibility`, `release`, `training`,
  `status`, `rating`, `edges`, structured state, or `personalityType`
  ([ADR-0038](0038-player-fields-red-lines-goals-personality.md)). Its `contentHash` is
  recomputed over the projection ([ADR-0034](0034-content-hash.md)), so identical shared
  content is recognisable across users ([ADR-0021](0021-privacy-and-sharing-model.md)).
- No share egress is built in this phase. The sharing slice must send only `prepareShare`
  objects and add a hash-bound confirmation per share, like exports
  ([ADR-0031](0031-gate-rules-and-confirmation-binding.md)).

### Models stay as decided

- Decision and rule cards (and every other user-originated card) may go to a `local_model`
  under the gate rules and to a `cloud_model` only through a confirmed, hash-bound transfer.
  `decide` never allows `cloud_model`; the transfer must list them explicitly. Stance data
  never goes to any model.
- `demo` is unchanged (rules only, default deny). Whether a demo in front of an audience
  counts as "other people" is an open owner question.

### Consequences

- Good, because the owner's rule is enforced by construction in one place, with a reason the
  user can read.
- Good, because classification fails closed; a misclassification can only make a card
  private, never shareable.
- Bad, because some legitimately public cards are not shareable: cards pinned by an agent
  (author `agent:<name>`), cards whose source is free text, and legacy cards without a layer.
  The user can re-create such a card as a human card with a public address.
- Bad, because two acts are needed to share an external card (a rule and a release).
- Neutral: OD-7 is resolved; ADR-0012's "conclusions are stance data only" and ADR-0021's
  pending interpretation are refined by this ADR.

### Confirmation

- `packages/core/src/sharing.test.ts`: public-source detection, every origin-class row,
  the projection keeps content and provenance only, drops private player entries and the
  personality type, and rehashes.
- Gate conformance kit (`describeDisclosureGateConformance`), run by the reference gate: with
  an allow-all rule and a release, a decision, a rule, a rating, an assumption, agent output,
  an own classification without a public source, a card citing an own card and an unclassified
  card are all denied for `share`; own experience is shared only after release; an
  external-source card only after release and an allow rule, and a deny rule still wins;
  `prepareShare` carries content and provenance only and validates against `SharedCard`;
  decision and rule cards are denied for `share`, need a confirmation for `cloud_model`, and
  are released by a confirmed transfer; stance data is denied for `share`.
- Schema fixtures: valid share bundle, shared card and share decision; invalid shared cards
  with tags, a personality type, store identity, a goal citing an own assessment, an agent
  author or no public source; a full card in a share bundle; stance to `share`; a context
  package for `share`; an agent proposal that releases a card.

## Pros and Cons of the Options

### Reuse `demo` or `cloud_model`

- Good, because no new target.
- Bad, because their semantics differ: models may receive conclusions, demos are rule-based;
  other people may never receive them.

### Stored `origin` field

- Good, because explicit.
- Bad, because any store, adapter or agent could set it wrongly, and existing cards would need
  a migration; the owner store has no such field.

### `share` target with derived class and `release`

- Good, because enforced centrally, fail-closed, no new stored field.
- Bad, because derivation rules may need refinement when the platform slice starts.

## More Information

- Resolves OD-7 of the [architecture documentation](../architecture/09-decisions.md).
- Refines [ADR-0012](0012-disclosure-gate.md) (targets; "conclusions are stance data only")
  and [ADR-0021](0021-privacy-and-sharing-model.md) (the pending interpretation of
  "conclusions"), and adds `share` to the rule targets of
  [ADR-0031](0031-gate-rules-and-confirmation-binding.md).
- Supersedes concept v1: nothing beyond ADR-0021.
- Related: [ADR-0008](0008-believed-as-private-stance.md),
  [ADR-0011](0011-agent-moves-are-proposals.md), [ADR-0035](0035-level1-engine-socket.md),
  [ADR-0038](0038-player-fields-red-lines-goals-personality.md).
