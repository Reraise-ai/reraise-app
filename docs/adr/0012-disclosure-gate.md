---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0012: Disclosure gate, default deny, per card and per target

## Context and Problem Statement

A user's knowledge store can contain identity documents, tax identifiers
and bank statements next to harmless notes. The product sends context to
models (local and cloud), shows boards in demos, and later shares cards.
Once private data reaches a cloud model or a demo, it cannot be recalled.
Concept v1 relied on configuration flags (`cloud_allowed_purposes`,
`send_stances_to_cloud`). How do we guarantee that nothing leaves without
an explicit allow?

## Decision Drivers

- Irreversibility of leaks.
- Decision per card, not per world or per request.
- Cloud transfers need the user's explicit consent each time.
- Stances never leave the device ([ADR-0008](0008-believed-as-private-stance.md)).
- One testable component, not scattered checks.

## Considered Options

- Global configuration flags per purpose (concept v1)
- Per-world privacy levels
- A disclosure gate deciding per card and target, default deny (chosen)

## Decision Outcome

Chosen option: "A disclosure gate deciding per card and target, default
deny", because only per-card decisions can separate a passport scan from
a news claim in the same world, and default deny fails safe.

- `DisclosureGate.decide(card, target) → {decision: allow | deny,
  reason}` with `target ∈ {screen, local_model, cloud_model, demo}`.
  Lives in `packages/disclosure-gate`.
- Default deny: no matching allow rule means deny, for every target. The
  reference configuration contains an explicit allow rule for `screen`
  for the local user; adapters add rules for their sensitive classes.
- `cloud_model` additionally requires a per-transfer confirmation by the
  user (human-only endpoint), showing exactly which cards will be sent.
  No standing consent.
- `demo` allows only cards cleared for demos (for example synthetic).
- Conclusions are stance data only: position, weight, note (including a
  note mapped from a store's own-assessment field `einordnung`,
  [ADR-0023](0023-core-domain-model.md)) and stance history. Conclusions
  are allowed for `screen` only, with no rule able to widen this. Context
  packages never contain them.
- Cards the user wrote, including own-assessment, decision and rule cards,
  are ordinary cards: they fall under the normal per-card gate decision
  and, for `cloud_model`, the per-transfer confirmation.
- Every egress path calls the gate: context packages, `ModelConnector`
  calls (including the level-1 Jev connector), MCP responses and exports.
- Exports (training export, any file export meant to leave the device) are
  decided under `cloud_model` semantics: allow rule required per card plus
  a per-export confirmation listing what is exported.
- Each MCP client connection is registered with the target class it
  represents (`local_model` or `cloud_model`); an unregistered connection
  is denied.
- Gate decisions are logged locally (card id, target, decision, reason),
  never the card content.

### Consequences

- Good, because a missing rule cannot leak data.
- Good, because the "cloud warning for private cards" requirement is met
  by construction.
- Bad, because a fresh installation shows little to models until the user
  writes allow rules; onboarding must explain this.
- Bad, because per-transfer confirmation adds friction to cloud use, by
  design.

### Confirmation

Unit tests: default deny for every target; stance denied for all targets
except `screen`; `cloud_model` without confirmation denied. M1 e2e: the
gate blocks a private card for target `cloud_model`.

## Pros and Cons of the Options

### Global flags

- Good, because simple.
- Bad, because all-or-nothing per purpose; one sensitive card leaks with
  the rest.

### Per-world levels

- Good, because coarse control is easy.
- Bad, because a card can be in several worlds; sensitive cards hide in
  harmless worlds.

### Per-card gate

- Good, because precise and testable.
- Bad, because needs rules and onboarding.

## More Information

- Supersedes concept v1: `docs/04-architektur.md` §5 `[privacy]`
  configuration, §6 `privacy: "no-stances"` option, §11 "Datenschutzstufen".
- Related: [ADR-0005](0005-universal-adapter-architecture.md),
  [ADR-0015](0015-two-thinking-levels.md),
  [ADR-0021](0021-privacy-and-sharing-model.md),
  [ADR-0026](0026-security-defaults.md).
