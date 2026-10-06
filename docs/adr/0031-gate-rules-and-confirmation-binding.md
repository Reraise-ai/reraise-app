---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0031: Declarative gate rules and hash-bound cloud confirmations

## Context and Problem Statement

[ADR-0012](0012-disclosure-gate.md) decides that a disclosure gate allows or denies each card per
target, with default deny and a per-transfer confirmation for `cloud_model`. It does not say how
users write rules, which card fields a rule may match, or how a confirmation is tied to what the
user actually saw. A confirmation that is not bound to the exact payload could be reused for a
different set of cards.

## Decision Drivers

- Default deny must stay the result of a missing or malformed rule.
- Narrow rules must be easy to write, so users are not pushed to over-broad ones.
- Stance data never leaves the screen; no rule can widen this
  ([ADR-0008](0008-believed-as-private-stance.md)).
- A confirmation must cover exactly the payload shown, once, for a short time.

## Considered Options

- Rules as code (user-supplied JavaScript predicates)
- Declarative YAML allow and deny rules over canonical card fields (chosen)
- Per-card flags only (an allow list of card ids per target)

Confirmation:

- Standing consent per session
- Single-use token bound to the hash of the exact payload, short time to live (chosen)

## Decision Outcome

Chosen options: "Declarative YAML allow and deny rules over canonical card fields" and
"single-use token bound to the hash of the exact payload", because they are auditable, cannot
execute code, and make a confirmation worthless for any other payload.

### Rule language

- Rules live in `.worldbuilder/gate-rules.yaml` ([ADR-0030](0030-local-state-on-the-device.md)).
- Each rule has an `id`, an `effect` (`allow` or `deny`), one or more `targets` (`screen`,
  `local_model`, `cloud_model`, `demo`) and a `match` block.
- `match` may test these canonical card fields only: `visibility`, `class`, `collection`,
  `worlds`, `type`, `tags` (once the card schema defines them) and explicit card `ids`. Within a
  `match` block all conditions must hold; a list of values means any of them.
- Evaluation per card and target: if any matching rule has `effect: deny`, the result is deny;
  otherwise, if any matching rule has `effect: allow`, the result is allow; otherwise deny.
  Deny rules always win. The reason names the deciding rule id or "default deny".
- A file that does not validate against the rule schema is not partially applied: every
  decision is deny until it is fixed, and the board shows the error.
- Stance data is not a card field and cannot be matched. Stance data is allowed for `screen`
  only, independent of any rule ([ADR-0012](0012-disclosure-gate.md)).

Example (synthetic):

```yaml
rules:
  - id: screen-all
    effect: allow
    targets: [screen]
    match: {}
  - id: geo-public-to-local
    effect: allow
    targets: [local_model, cloud_model]
    match: { worlds: [Geopolitics], visibility: [public] }
  - id: never-class-a
    effect: deny
    targets: [local_model, cloud_model, demo]
    match: { class: [A] }
```

### Cloud confirmation binding

- Before a `cloud_model` transfer the service builds the exact canonical payload (gate-cleared
  canonical objects only), serialises it as canonical JSON (RFC 8785) and computes its SHA-256.
- The preview shown to the user lists the cards in that payload. The human-only disclosure
  confirm endpoint issues a single-use confirmation token bound to that hash, valid for
  5 minutes.
- The connector sends only if the payload it is about to send hashes to the bound value. Any
  change to the payload (a card added, removed or edited, a different engine) invalidates the
  token; the user must confirm again. A used or expired token is rejected.
- Exports use the same binding under `cloud_model` semantics
  ([ADR-0017](0017-decision-card-and-training-export.md)).

### Consequences

- Good, because rules are data, reviewable and testable, and cannot run code.
- Good, because a confirmation cannot be replayed for a different payload or later.
- Bad, because users must learn a small rule format; onboarding and examples are needed.
- Bad, because any edit after preview forces a new confirmation, by design.

### Confirmation

Unit tests: no rules → deny for every target; deny beats allow; invalid rule file → deny
everywhere; no rule can allow stance data beyond `screen`; a token is rejected after use, after
5 minutes, and for a payload whose hash differs by one card.

## Pros and Cons of the Options

### Rules as code

- Good, because maximal flexibility.
- Bad, because executing user code in the gate is a security risk and hard to audit.

### Declarative YAML rules

- Good, because simple, auditable, schema-validated.
- Bad, because limited to the listed fields; extensions need an ADR.

### Per-card id lists only

- Good, because trivial.
- Bad, because unusable for large worlds; pushes users to bulk allows.

### Standing consent per session

- Good, because less friction.
- Bad, because contradicts "each transfer confirmed" of ADR-0012.

### Hash-bound single-use token

- Good, because exact and short-lived.
- Bad, because needs canonical serialisation.

## More Information

- Supersedes concept v1: nothing beyond ADR-0012.
- Resolves open decision OD-3 of the [architecture documentation](../architecture/09-decisions.md).
  What may go to cloud models in a given installation remains the user's (and for the owner's
  store, the owner's) rule set.
- Related: [ADR-0008](0008-believed-as-private-stance.md), [ADR-0012](0012-disclosure-gate.md),
  [ADR-0026](0026-security-defaults.md), [ADR-0030](0030-local-state-on-the-device.md).
