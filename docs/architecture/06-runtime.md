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
  participant P as local-state
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
  Note over C,P: core calls the LocalStateStore port that the service injects. core itself does no I/O.
  MCP-->>A: proposal id, status pending
  UI->>API: proposal_list with changedSince cursor, polled every 2 s
  API-->>UI: pending proposal and nextCursor, drawn dashed with its author

  Note over H,P: A human accepts
  H->>UI: Accept
  UI->>API: accept proposal (human-only endpoint, agent tokens rejected)
  API->>C: apply create_card, author stays agent:test-agent
  C->>SA: create(card)
  SA->>F: validate, lock, write new card file
  SA-->>C: canonical id of the new card
  C->>P: status accepted, decidedBy, decidedAt (through the injected LocalStateStore port)
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

## 6.2 Level 1 prediction through a cloud engine

Status: planned (level-1 slice right after M1). Level 1 is the `Level1Engine` socket
([ADR-0035](../adr/0035-level1-engine-socket.md)): per player on the Lage, the engine predicts
the next move out of a closed set of move options, from the cards on the board and the user's
rule cards. The default engine is local (`local_model`, no confirmation, automatic what-if
re-runs). The flow below is the cloud case, for example the Jev adapter, whose wire format
stays inside the adapter: every run is `cloud_model` egress with per-transfer confirmation.

```mermaid
sequenceDiagram
  autonumber
  actor H as Human
  participant UI as Board app
  participant API as Board API
  participant C as core
  participant G as Disclosure gate
  participant E as Level1Engine (cloud adapter)
  participant X as External engine

  H->>UI: Changes an assumption on the Lage, engine is a cloud engine
  UI->>API: level-1 run (Lage, trigger assumption_changed)
  API->>C: build request: players with move options, cards on the board plus rule cards
  loop each request card
    C->>G: decide(card, cloud_model)
    G-->>C: allow or deny with reason
  end
  Note over C,G: Stance data is never a candidate
  C-->>API: request of cleared cards, denied cards with reasons
  API->>G: preview(purpose level1, connector = engine, cleared cards)
  G-->>API: transfer: envelope, payloadHash, expiry in 5 min
  API-->>UI: prediction marked stale, preview of the whole envelope
  alt the human declines
    Note over API,G: Nothing is sent. The gate log keeps ids and decisions, never content.
  else the human confirms
    H->>UI: Confirm this transfer
    UI->>API: confirm with transferId and previewed hash (human-only)
    API-->>UI: single-use token bound to this session, valid 5 minutes
    UI->>API: run with token
    API->>G: redeem(token, envelope)
    G-->>API: release: exactly the confirmed objects
    API->>E: predict(request, release)
    E->>E: refuse unless the release holds exactly the request cards
    E->>X: provider request over HTTPS, credential from environment or keychain
    X-->>E: typed answer
    E-->>API: Level1Prediction
    API->>C: validate: schema, move in options, cards from the request, request hash
    alt invalid
      API-->>UI: show the error, keep the prediction stale
    else valid
      API-->>UI: prediction per player
      UI-->>H: "<engine> estimates 0.71 for Keep restrictions" next to each player, with the cards used
      opt escalate a player prediction to level 2
        H->>UI: Escalate
        UI->>API: Lage create: question about that player's next move, options, cards used placed
      end
    end
  end
```

Any change after the preview (a card, the engine, the players, the move options) changes the
envelope hash and the request hash; the confirmation fails and the prediction stays stale until
the user confirms a new transfer ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)).
A prediction is not a card, not a decision, triggers no rule, enters no statistics and is never
shared ([ADR-0036](../adr/0036-conclusions-are-private.md)). With a local engine the same flow
has no preview, confirmation or release; it runs on every trigger and shows the latest
prediction whose request hash is current.

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
| Model or level-1 engine unavailable | The request fails visibly; no proposal, no fallback to another target without a new gate decision | [ADR-0012](../adr/0012-disclosure-gate.md), [ADR-0035](../adr/0035-level1-engine-socket.md) |
