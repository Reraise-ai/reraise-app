# 6. Runtime view

Three scenarios show how the building blocks of [section 5](./05-building-blocks.md)
cooperate. **None of them runs today.** Scenario 6.1 is the target of milestone M1, 6.2 and
6.3 belong to M2+ slices and to adapters outside this repository. Endpoint and message names
are descriptive; the normative names are in the OpenAPI contract and the MCP tool definitions
(in progress, M0). The process layout follows [ADR-0029](../adr/0029-process-topology.md):
the Board API and the MCP server run in one local service process.

## 6.1 M1 walking skeleton

Status: planned (M1). This is the Hormuz scenario of the
[roadmap](../roadmap.md#m1-walking-skeleton); one Playwright test will run it end to end in CI
(M1-01 in [verification](../verification.md#m1-walking-skeleton)). All data is synthetic.

```mermaid
sequenceDiagram
  autonumber
  actor H as Human
  participant UI as Board app
  participant API as Board API
  participant C as core
  participant G as Disclosure gate
  participant SA as markdown-files adapter
  participant F as Card files
  participant P as local-state (.worldbuilder)
  participant MCP as MCP server at /mcp
  participant A as Test agent

  Note over H,F: Open a Lage
  H->>UI: Open Lage "Hormuz"
  UI->>API: GET Lage (human session token)
  API->>SA: read Lage card
  SA->>F: read file, parse the Position JSON block
  SA-->>API: canonical Lage at version n
  API->>G: decide(card, screen) for each placed card
  G-->>API: allow (explicit screen rule)
  API-->>UI: Lage with cards and edges

  Note over H,F: Place a card and draw a supports edge
  H->>UI: Drag an existing card onto the board
  H->>UI: Draw a supports edge from card A to card B
  UI->>API: Lage save (version n, cards with x and y, edge by human)
  API->>C: validate against the Lage schema
  API->>SA: write Lage, expected version n
  SA->>F: move previous file to _archive as version n, write version n+1
  SA-->>API: saved, version n+1
  API-->>UI: saved

  Note over A,P: An agent proposes a card
  A->>MCP: proposal_create(kind create_card, payload) with agent token
  MCP->>MCP: author = agent:test-agent from the token, never from the payload
  MCP->>C: validate proposal, status pending
  C->>P: store pending proposal
  MCP-->>A: proposal id, status pending
  UI->>API: GET /proposals?since=cursor, polled every 2 s
  API-->>UI: pending proposal, drawn dashed with its author

  Note over H,P: A human accepts
  H->>UI: Accept
  UI->>API: accept proposal (human-only endpoint, agent tokens rejected)
  API->>C: apply create_card, author stays agent:test-agent
  C->>SA: create(card)
  SA->>F: validate, lock, write new card file
  SA-->>C: canonical id of the new card
  C->>P: status accepted, decidedBy, decidedAt
  API-->>UI: accepted, card id

  Note over H,F: Reload
  H->>UI: Reload the page
  UI->>API: GET Lage
  API->>SA: read Lage and cards
  SA->>F: read files
  API-->>UI: version n+1 with the placed card, the edge and the accepted card

  Note over H,G: Context package and the gate
  H->>UI: Preview context package for target cloud_model
  UI->>API: GET context package (Lage, target cloud_model)
  API->>C: assemble from question, cards, relations and provenance
  loop each candidate card
    C->>G: decide(card, cloud_model)
    G-->>C: allow or deny with reason
  end
  Note over C,G: The synthetic private card has no allow rule: deny
  C-->>API: package with cleared cards, denied cards with reasons, pending proposals in a separate section, no stance data
  API-->>UI: preview with cloud warning, private card shown as denied
  Note over H,UI: Nothing is sent. In M1 there is no cloud connector, the scenario ends at the gate decision.
```

Points the end-to-end test asserts:

- The Lage, the placed card, the edge and the accepted card survive a reload because they are
  in the files, and the previous Lage version is in `_archive/`
  ([ADR-0006](../adr/0006-files-are-the-truth.md)).
- The accepted card keeps `author: agent:test-agent`; before acceptance it counted nowhere
  ([ADR-0011](../adr/0011-agent-moves-are-proposals.md)).
- The private card is denied for `cloud_model` and shown as denied, not silently dropped
  ([ADR-0012](../adr/0012-disclosure-gate.md)).

## 6.2 Level 1 decision through Jev

Status: planned (M2+). The Jev connector is a stub implementing the documented request and
response shape until the owner fixes the interface
([ADR-0015](../adr/0015-two-thinking-levels.md)). Jev is cloud-only, so every call is
`cloud_model` egress with per-transfer confirmation.

```mermaid
sequenceDiagram
  autonumber
  actor H as Human
  participant UI as Board app
  participant API as Board API
  participant C as core
  participant G as Disclosure gate
  participant JC as Jev connector
  participant J as Jev
  participant P as local-state (.worldbuilder)

  H->>UI: Quick question with options, engine Jev
  UI->>API: Level 1 request (question, options, engine)
  API->>C: build request: options as enum, candidate inputs from active rules and cards
  loop each candidate input card
    C->>G: decide(card, cloud_model)
    G-->>C: allow or deny with reason
  end
  Note over C,G: Stance data and stance-dependent rules are never candidates
  C-->>API: transfer preview: cleared cards, denied cards with reasons
  API->>API: SHA-256 of the exact canonical payload
  API-->>UI: confirmation dialog listing exactly what would leave the device
  alt the human declines
    H->>UI: Cancel
    UI->>API: cancel transfer
    Note over API,G: Nothing is sent. The gate log keeps card ids and decisions, never content.
  else the human confirms
    H->>UI: Confirm this transfer
    UI->>API: disclosure confirm (human-only endpoint)
    API-->>UI: single-use token bound to the payload hash, valid 5 minutes
    UI->>API: send with token
    API->>API: payload hash equals the bound hash, token unused and not expired
    API->>JC: decide(output schema, cleared canonical objects)
    JC->>J: POST /v1/decide over HTTPS, credential from environment or keychain
    J-->>JC: typed answer with calibrated confidence
    JC->>C: validate against the Level 1 result schema
    alt the answer does not validate
      C-->>API: error, nothing stored
      API-->>UI: show the error
    else valid
      C-->>API: engine, options, choice, confidence, inputs
      API-->>UI: result
      UI-->>H: "Jev estimates 0.82 for X", with its inputs, never a verdict
      opt the answer implies world changes
        JC->>P: proposals with author agent:jev, status pending
      end
      opt escalate to Level 2
        H->>UI: Escalate
        UI->>API: Lage save: new Lage with question, options and input cards placed
      end
    end
  end
```

If anything in the payload changes after the preview, its hash changes and the token is
invalid; the user must confirm again ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)).
A Level 1 answer is not a decision, triggers no rule and enters no statistics. The same flow
with a local rules engine or a local model uses target `local_model` and needs no per-transfer
confirmation, but still a gate decision per card.

## 6.3 Write-back patch to an external store

Status: planned. The reference `markdown-files` adapter implements this flow inside the
adapter (M1). A store with its own write channel, such as the owner's card store, has an
adapter that delegates to that channel; that adapter is built and operated outside this
repository against the same conformance kit
([ADR-0005](../adr/0005-universal-adapter-architecture.md)).

The trigger is any accepted change to a card that lives in an external store, here a human
accepting an `add_edge` proposal on card X.

```mermaid
sequenceDiagram
  autonumber
  participant API as Board API
  participant C as core
  participant SA as Store adapter
  participant WC as Store write channel
  participant F as Store files

  API->>C: apply accepted change: add supports edge to card X
  C->>SA: patch(card X, changed field edges, expected contentHash h1)
  SA->>SA: resolve canonical id to the store id through the uri
  SA->>SA: map edge target to its store id and the edge kind to the store's name
  SA->>WC: patch request for the store id, field edges, expected hash h1
  WC->>WC: acquire lock
  WC->>F: read the current file
  alt the file changed since h1
    WC-->>SA: conflict, nothing written
    SA-->>C: conflict
    C-->>API: 409 conflict, the board reloads and the human re-applies
  else unchanged
    WC->>WC: replace only the edges field
    Note over WC,F: Every other byte stays verbatim: fields the product does not own, unknown fields, field order, formatting, body
    WC->>WC: validate with the store's own validator
    alt invalid
      WC-->>SA: rejected, file untouched
      SA-->>C: validation error
    else valid
      WC->>F: archive the previous version if the store archives on rewrite
      WC->>F: write the patched file
      WC->>WC: release lock
      SA->>F: re-read the file
      SA-->>C: canonical card, same canonical id, new contentHash h2
    end
  end
```

Why this matters:

- **Foreign fields survive.** A store may hold fields the product does not model, or models
  elsewhere: an own-assessment field becomes a private stance note on read
  ([ADR-0008](../adr/0008-believed-as-private-stance.md)), but stays verbatim in the file.
  The conformance kit proves that a patch changes only the patched field
  ([ADR-0023](../adr/0023-core-domain-model.md)).
- **Ids stay stable.** The canonical id is derived from the URI, so it is the same after the
  write, after an index rebuild and on another machine.
- **Egress is canonical.** What later leaves the device is the canonical object after a gate
  decision, never the raw file, so foreign fields cannot leak through egress
  ([ADR-0012](../adr/0012-disclosure-gate.md)).

## 6.4 Failure behaviour across scenarios

| Situation | Behaviour | Source |
| --- | --- | --- |
| No gate rule matches | Deny, with a reason, for every target | [ADR-0012](../adr/0012-disclosure-gate.md) |
| Unregistered MCP connection or missing token | Rejected; nothing is read | [ADR-0012](../adr/0012-disclosure-gate.md), [ADR-0026](../adr/0026-security-defaults.md) |
| Agent token on a human-only endpoint | Rejected | [ADR-0026](../adr/0026-security-defaults.md) |
| Schema-invalid or oversized input | Rejected and logged without card content | [ADR-0026](../adr/0026-security-defaults.md) |
| Concurrent writes to the same card or Lage | Optimistic concurrency on `version` or `contentHash`; the loser gets a conflict and nothing is written | [ADR-0006](../adr/0006-files-are-the-truth.md) |
| Derived index missing or corrupt | Deleted and rebuilt from the files | [ADR-0006](../adr/0006-files-are-the-truth.md) |
| Model or Jev unavailable | The request fails visibly; no proposal, no fallback to another target without a new gate decision | [ADR-0012](../adr/0012-disclosure-gate.md), [ADR-0015](../adr/0015-two-thinking-levels.md) |
