---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0021: Privacy and sharing model for the later platform

## Context and Problem Statement

The canon envisions a later platform: private worlds by default, single
cards shared deliberately, a common knowledge graph of many private
systems. Concept v1 sketched federation with signed cards, relays, an
optional hub and optionally shareable stances. The owner has since ruled
on privacy, peer-to-peer exchange, the hosted platform and the economy.
What do we build now, and what must the data model keep open?

## Decision Drivers

- Data stays local with the user.
- Conclusions and anything not publicly findable are private.
- No platform features in this phase; no migration needed later.
- Economy, monetisation, card-exchange economics, gamification and crypto
  are out of scope for this repository.

## Considered Options

- Build federation now (concept v1 phase 4 design)
- Central hosted sharing service inside this repository
- Keep the model open only; define the privacy rules; build nothing yet
  (chosen)

## Decision Outcome

Chosen option: "Keep the model open only", because the owner placed the
platform and the economy outside this phase, while the data model must
not block them.

Privacy rules (binding now):

- Worlds and cards are private by default (`visibility` private,
  `release: private`).
- A shared card carries content and provenance only. The user's stance
  data (the conclusions of [ADR-0012](0012-disclosure-gate.md)) never
  leaves the device
  ([ADR-0008](0008-believed-as-private-stance.md)). Reading the owner's
  word "conclusions" as stance data is a CTO interpretation pending owner
  confirmation.
- Users explicitly unlock what they share and how; the disclosure gate
  enforces it ([ADR-0012](0012-disclosure-gate.md)).
- Private exchange between users is peer-to-peer and end-to-end
  encrypted, never through platform servers.
- The hosted platform (card exchange, shared wiki) is a separate, closed
  service outside this repository ([ADR-0004](0004-two-tier-licensing.md)).

Data model kept open (no implementation):

- Globally unique ids (ULID) plus `contentHash` (SHA-256 over canonical
  content), so identical content is recognisable across users and counts
  as one origin ([ADR-0009](0009-mandatory-provenance.md)).
- `level` reserved for card tiers, `signature` reserved for an author key
  pair signature; `release` (`private` | `community` | `commercial`)
  recorded but without behaviour.
- Provenance chain kept on every card.

### Consequences

- Good, because nothing in this phase can leak through a sharing feature.
- Good, because the platform can be added without migrating card data.
- Bad, because concept v1's federation design (key choice, relays, hub,
  retraction) is not decided; it returns as ADRs when the platform starts.
- Bad, because the stance-sharing option of concept v1 is removed for good.

### Confirmation

Schema tests: `level` and `signature` reserved; `release` defaults to
`private`. Gate tests: stance never allowed beyond `screen`. No network
sharing code in the repository (review).

## Pros and Cons of the Options

### Build federation now

- Good, because the vision becomes tangible early.
- Bad, because out of scope by owner decision; large security surface.

### Central hosted service in this repo

- Good, because simple discovery.
- Bad, because contradicts "never via platform servers" for private
  exchange and the closed-platform decision.

### Model open, build nothing

- Good, because zero risk now, no lock-out later.
- Bad, because the platform remains a promise.

## More Information

- Supersedes concept v1: `docs/04-architektur.md` §10 platform outlook
  (Ed25519 choice, relays and optional hub, `CardShared` /
  `RemoteCardReceived` events, `origin: 'federated'`, stances optionally
  `shared`), `docs/03-datenmodell.md` §2 `Visibility` and `Federation`
  types, `docs/05-roadmap.md` phase 4 and open decision 5.
- Related: [ADR-0004](0004-two-tier-licensing.md),
  [ADR-0012](0012-disclosure-gate.md),
  [ADR-0023](0023-core-domain-model.md).
