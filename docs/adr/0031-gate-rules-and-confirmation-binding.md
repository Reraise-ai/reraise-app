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

- Rules live in `<state>/gate-rules.yaml`, the per-user state directory ([ADR-0030](0030-local-state-on-the-device.md)).
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

### Rule sources and schema

- The rule file is validated against `schemas/gate-rules.schema.json` (JSON Schema 2020-12). The
  schema is added on the contracts branch together with valid and invalid examples.
- Adapters may supply rule fragments for their sensitive classes (for example a store that marks
  identity documents). The effective rule set is the union of the user's file and all adapter
  fragments, evaluated with the same deny-wins rule, so a fragment can only add allows the user
  could also write and can never override a deny. The board shows the effective rule set with
  the source of every rule.

### MCP connections

- An MCP connection registered as `cloud_model` receives card content in a response only after a
  hash-bound transfer for exactly that response was confirmed by the human, using the mechanism
  below. Without it, the response contains the denied ids and reasons only.
- A connection registered as `local_model` follows the gate rules without per-transfer
  confirmation.

### Cloud confirmation binding

- **Envelope.** Before any `cloud_model` transfer the service builds a transfer envelope:
  `target`, `connectorId` (the engine, for example Jev or a named cloud model), the request
  parameters (question, options, output schema, where present) and the gate-cleared canonical
  objects. It serialises the envelope as canonical JSON (RFC 8785) and computes its SHA-256.
  The preview shows the whole envelope to the user, not only the card list.
- **Preview creates a transfer record** held server side: `transferId`, the stored hash and an
  expiry 5 minutes ahead.
- **Confirm.** The human-only confirm call carries `transferId` and the hash the user previewed.
  The service recomputes the hash of the current envelope and rejects the call if either the
  previewed hash or the recomputed hash differs from the stored one.
- **Token.** On success the service issues a confirmation token: at least 128 bits from a
  cryptographically secure random source, stored server side only, bound to the human session
  that confirmed, single-use, valid for 5 minutes. All tokens and transfer records live in
  memory and are invalid after a service restart.
- **Send.** The connector call consumes the token atomically before sending (a second use fails
  even under concurrency) and sends only an envelope whose hash equals the stored hash. Any
  change (a card added, removed or edited, another engine, a changed question, options or output
  schema) produces a different hash and requires a new preview and confirmation.
- Exports use the same binding under `cloud_model` semantics
  ([ADR-0017](0017-decision-card-and-training-export.md)), with the export parameters in the
  envelope.

### Consequences

- Good, because rules are data, reviewable and testable, and cannot run code.
- Good, because a confirmation cannot be replayed for a different payload or later.
- Bad, because users must learn a small rule format; onboarding and examples are needed.
- Bad, because any edit after preview forces a new confirmation, by design.

### Confirmation

Rule tests: no rules → deny for every target; deny beats allow; an invalid rule file → deny
everywhere; an adapter fragment cannot override a user deny; no rule can allow stance data
beyond `screen`; the rule schema accepts its valid examples and rejects its invalid ones.

Confirmation tests: the send is rejected when, after the preview, the engine differs, the
question or options or output schema changed, or a card was added, removed or edited; a confirm
call whose previewed hash does not match the transfer record is rejected; a replayed token is
rejected, also when two sends race; a token is rejected after 5 minutes, after a service
restart, and from a different session; a `cloud_model` MCP connection receives no card content
without a confirmed transfer.

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
- Bad, because needs canonical serialisation and server-side transfer records.

## More Information

- Supersedes concept v1: nothing beyond ADR-0012.
- Resolves open decision OD-3 of the [architecture documentation](../architecture/09-decisions.md).
  What may go to cloud models in a given installation remains the user's (and for the owner's
  store, the owner's) rule set.
- Related: [ADR-0008](0008-believed-as-private-stance.md), [ADR-0012](0012-disclosure-gate.md),
  [ADR-0026](0026-security-defaults.md), [ADR-0030](0030-local-state-on-the-device.md).
