# Adapter interfaces

The interfaces through which The Worldbuilder reaches stores, sources, models and the
outside world ([ADR-0005](../adr/0005-universal-adapter-architecture.md)). They are TypeScript
types in `packages/core/src/adapters/`, typed against the types generated from the JSON
Schemas ([ADR-0028](../adr/0028-json-schema-contract-conventions.md)). If this page and the
code differ, the code and the schemas win and this page is a bug.

## StorageAdapter

One backend that holds cards, worlds, Lagen and decisions: the reference `markdown-files`
adapter (M1), the owner store's adapter, or any third-party store.

| Member | Contract |
| --- | --- |
| `storeInstanceId` | random UUID of the store, part of every card URI; never a hostname, path or user name |
| `capabilities` | `write`, `search`, and `ids`: `native` (the store keeps the ULID) or `derived` (the id is derived from the URI) |
| `read(id)`, `list(query)`, `search(query)`, `listWorlds()` | return canonical cards that validate against `card.schema.json`, each with its `contentHash` ([ADR-0034](../adr/0034-content-hash.md)) |
| `create(draft, author)` | returns the canonical id; callers never predict it. Rejects drafts that break the provenance rules, carry an id or an author, put player fields on a non-actor, or set `validUntil` earlier than `validFrom` ([ADR-0048](../adr/0048-card-descriptive-fields.md)) |
| `patch(id, patch, guard?)` | changes only the given canonical fields; every other byte of the stored card stays as it was. Never identity, format, author, hash or stance data. A Lage rewrite archives the previous version. Rejects a result whose `validUntil` is earlier than `validFrom` |
| `archive(id)`, `versions(id)` | nothing is deleted; history is archived versions ([ADR-0006](../adr/0006-files-are-the-truth.md)) |
| `readLegacyStance?(id)` | read only: stance data a store already holds (believed layer, own assessment), mapped per [ADR-0008](../adr/0008-believed-as-private-stance.md); never written back |

Identity: `buildUri(storeInstanceId, externalId)` gives the one canonical URI of a card,
`deriveCardId(uri)` its derived ULID. Only canonical URIs are accepted
([ADR-0023](../adr/0023-core-domain-model.md)).

Conformance: every adapter runs `describeStorageAdapterConformance` from
`@worldbuilder/conformance` with a harness (`adapter`, `reopen`, `relocate`, `raw`, `seed`).
The kit checks ids across instances and locations, canonical URIs, valid cards, content
hashes, byte-identical patches, legacy defaults and the stance mappings.

### The reference adapter: `markdown-files`

`MarkdownFilesAdapter.open(folder, options)` in `packages/adapters/storage-markdown-files`
(Apache-2.0) implements `StorageAdapter` over a folder in the [card format](./card-format.md):

```
worldbuilder-store.yaml       store configuration with the random storeInstanceId
world.json, worlds/*.json     worlds (cards may also name worlds that have no file)
cards/**/*.md                 one card per file; the canonical ULID is the `id` field
cards/**/_archive/<file>.v<n>.md   archived versions, next to the card; never current cards
.worldbuilder/write.lock      the single-writer lock, held only while a write runs
```

- **Patches are byte-preserving.** Only the text range of a changed top-level field is
  rewritten. Foreign fields, comments, order, quoting and the file's line breaks stay. New
  files use LF. A patch that the card format cannot hold (for example a comma in a player-field
  entry) or that would produce an invalid card is rejected before anything is written.
- **One writer per store.** Every write takes an in-process queue and the lock file, re-reads
  the files, checks the guard and writes through a temporary file and a rename. A lock older
  than 60 s, or held by a process that no longer exists on this host, is broken.
  Before the rename that replaces a card (create and patch), the lock token is checked again;
  if the lock was lost, the write fails with `locked` and nothing is written (a version copy
  made for a Lage patch is removed again).
- **Derived index.** The index is built in memory at start and refreshed by a file watcher.
  Watcher events are hints: a changed file is re-read and a miss triggers a rescan
  ([ADR-0033](../adr/0033-derived-index-reference-adapter.md)). `rebuildIndex()` throws the
  index away and rebuilds it. Files that cannot be used are listed by `diagnostics()` and
  stay out of every result. Native watchers can miss changes made just after they start, so
  for a start-up window (`watchWarmupMs`, default 3 s) queries rescan until both the cards and
  the root watcher have delivered an event, and one rescan is forced when the window ends; the
  adapter writes nothing besides `.worldbuilder/write.lock`.
- **Search** matches all words case- and accent-insensitively in title, body and tags, and
  filters by `type`, `layer`, `worldId` and `tags`; a title match ranks first.
- **Lage save.** A patch with a `lage` needs the next version number; the previous version is
  archived as `_archive/<file>.v<n>.md`, and a stale `lageVersion` guard is a conflict.
- **No stance data.** The adapter has no stance writer and refuses stance fields in a patch.

## SourceConnector

Reports new findings from a connected source with their provenance; read only
([ADR-0014](../adr/0014-no-ingestion-inbox-of-findings.md)).

| Member | Contract |
| --- | --- |
| `id` | connector id, as in `Finding.connector` |
| `findings(query)` | findings that validate against `finding.schema.json`: a URI and a source or origin system on every one |
| `referenceCard(finding)` | the reference card a pin would create; writes nothing. Pinning is a human action or an agent proposal |

## ModelConnector

A replaceable model for level-2 support: a local or a cloud model answering a question about a
context package ([ADR-0015](../adr/0015-two-thinking-levels.md)).

| Member | Contract |
| --- | --- |
| `engine`, `target` | model name (also the proposal author `agent:<engine>`) and its disclosure target class |
| `ask(pkg, question, release?)` | level 2 support: text plus `ProposalCreate`s; it never writes |

A `cloud_model` connector is called only with the `DisclosureRelease` of one confirmed transfer
and sends nothing but its objects ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)).

## Level1Engine

The level-1 socket ([ADR-0035](../adr/0035-level1-engine-socket.md)): a fast engine that
predicts, for each player on a Lage, the next move out of a closed set of move options, from
the cards on the board and the user's rule cards only. The local default engine, a local
model or an external decision service (for example Jev) plug in here.

| Member | Contract |
| --- | --- |
| `engine`, `target` | engine id (shown as "`<engine>` estimates ...", proposal author `agent:<engine>`) and its disclosure target class |
| `deterministic` | true if the same request always yields the same prediction; the local default engine is deterministic |
| `predict(request, release?)` | a `Level1Prediction`: per player the move options, the predicted move (one of them), the engine's confidence in [0, 1] and the ids of the request cards it used, plus the RFC 8785 hash of the request. A `cloud_model` engine predicts only with the release of exactly the request's cards |

Conformance: `describeLevel1EngineConformance` from `@worldbuilder/conformance` with a harness
(`engine`, `request`); `level1PredictionProblems` is the same check as a function.
`createFixedLevel1Engine` is a trivial fake to start from. Real engines are in
[Level-1 engines](#level-1-engines).

## Level-1 engines

Package `@worldbuilder/level1-engines` (Apache-2.0): implementations of the `Level1Engine` socket
above and the helpers around them. It has no service code, no network code outside the injected
`fetch` of the cloud adapter, and imports nothing AGPL. The service wiring is another slice (see
[Service seam](#service-seam)).

| Export | What it is |
| --- | --- |
| `createLocalRulesEngine(options?)` | the default engine: `target: local_model`, `deterministic: true`, no network. Adds `explain(request)` |
| `explainLocalRules(request)` | pure: the per-player, per-option breakdown behind a prediction (the `basis`) |
| `buildMoveOptions(player, cards, extra?)` | candidate move options for a player: past moves, then the actions of the user's rule cards, then `extra` |
| `rerunOnAssumptionChange(engine, previous, request, release?)` | what-if re-run; `isStale`, `currentOnly`, `assumptionChangedRequest`, `changedMoves` |
| `buildLevel2Draft(prediction, request, playerCardId, options?)` | escalation: the body of the human-only `lage_create` |
| `createSystemOneHttpAdapter(options)` | cloud engine over a generic `POST /v1/decide`; `createJevAdapter` is the Jev preset |
| `formatEstimate(view)`, `formatEstimates(prediction)` | the board display text |

### Local rules engine

For each player card of the request, and for each of its move options, the engine computes nine
features in [0, 1] from the request cards only and adds them up with fixed weights
(`WEIGHTS`, exported):

| Feature | Weight | Meaning |
| --- | --- | --- |
| `behaviour` | +1.0 | share of the player's `moves` history that resembles the option (behaviour) |
| `linkedEvidenced` | +0.5 | an evidenced card linked to the player resembles the option (behaviour) |
| `interest` | +0.5 | best match with the player's `interests` (statement) |
| `assumedGoal` | +0.3 | best match with `assumedGoals` (statement, an assumption) |
| `linkedSaid` | +0.25 | a said card linked to the player resembles the option (statement) |
| `capability` | +0.25 | best match with `capabilities` (feasibility) |
| `rule` | +0.5 | a fired rule card of the user whose action matches the option |
| `dependencyRisk` | -0.75 | a disruptive option (stop, halt, close, cut, delay, ...) that touches a `dependencies` entry or a `depends_on` target |
| `redLineRisk` | -0.75 | a weak match with a red line (one shared word) |

- **Statements against behaviour.** Behaviour features outweigh statement features. When the best
  option by behaviour and the best by statements differ, `statementBehaviourDivergence` is set and
  behaviour decides.
- **Red lines.** An option that matches a `redLines` entry with at least two content words (60 %
  of the line's words), or that says it lacks what the line demands ("sail without war-risk
  cover" against "no sailings without war-risk cover"), is removed. An option that provides what a
  "without" line demands is not affected. If every option is removed, the engine predicts the
  highest scoring one at uniform confidence and sets `allExcluded`.
- **Rules.** A rule card is evaluated against the request cards only (`card_on_lage`,
  `card_field`, `tag` and `edge`). A rule with a `stance` condition never fires: the engine never
  receives stances. A fired rule whose `then` matches an option reads as the user's own
  expectation for that option, but only for a player the rule names in its conditions, or whose
  linked card the rule names (an edge to or from the player). A rule about the board in general
  boosts nobody (owner question OQ-20). The rule card and the cards it names count as used for
  the players it applies to.
- **Edges.** Only the `edges` stored on the request's cards count today (as dependencies,
  linked evidence and rule edge conditions). Edges drawn on the Lage (`Lage.edges`) are not part
  of the request and are not mapped yet: a follow-up of the service slice.
- **Confidence.** `softmax(score / T)` over the options that stayed, with `T =
  CONFIDENCE_TEMPERATURE = 0.5`; shrunk linearly towards 1/n when fewer than two kinds of
  evidence (`ENOUGH_EVIDENCE_KINDS`) were found; at most 0.95; at most 0.8 when an option was
  removed; rounded to two decimals. It is the engine's own estimate, not a fitted probability
  (owner question OQ-19).
- **Ties and no evidence.** Ties go to the earlier move option. No evidence gives the first
  option at 1/n.
- **`cardIds`.** The player card always first, then the request cards that contributed to some feature
  or removal (sources of matched entries that are on the board, linked cards, fired rule cards
  and the cards their conditions name), in request order. Never a card outside the request.
- **Limits.** Matching is lexical on content words of English phrases (light stemming, Dice
  overlap). It has no model of negation or meaning, which is why the breakdown exists.

`explain(request)` returns, per player, `options[]` with `features` (value and `via` card ids),
`contributions`, `score`, `probability`, `excluded`, `redLineHits`, plus `evidenceKinds`,
`firedRuleCardIds`, `temperature` and `weights`. The prediction itself stays schema-valid
(`level1-prediction.schema.json` has no extra fields), so a board that wants the "why" calls
`explain`.

### What-if re-run

`rerunOnAssumptionChange(engine, previous, request, release?)` needs a request with trigger
`assumption_changed` (`assumptionChangedRequest(request, ids)` sets it) and returns
`{ prediction, stale, reran, needsConfirmation, changes }`:

- the previous prediction already has the current request hash: nothing runs;
- a `local_model` engine runs; `changes` lists the players whose predicted move changed;
- a `cloud_model` engine runs only with the release of a freshly confirmed transfer; without it
  nothing is sent, the previous prediction comes back `stale: true` and `needsConfirmation: true`.

`isStale(prediction, request)` is the display rule of ADR-0035: the request hash with the trigger
left out (`stalenessKey`), so undoing an assumption makes the prediction current again.
`currentOnly(prediction, request)` drops a late answer. Debouncing (latest wins) is the caller's.
The helper also validates the engine's answer (`answerProblems`): another engine, Lage, request
hash or player list, or a move outside the options, is rejected with an error instead of being
shown.

### Escalation to level 2

`buildLevel2Draft(prediction, request, playerCardId, { seatName?, worlds?, now? })` returns
`{ create, sourceLageId, playerCardId, engine }`. `create` is a valid body for `lage_create`: the
question asks for that player's next move (and quotes the source question), the options are the
move options, the cards the engine used are placed (player card first), the only seat is the
human. The prediction (move, confidence, hash) is not copied. `sourceLageId` is the link back: the
service records it, for example as a `based_on` edge of the new Lage card, and the board shows it
with the engine's name.

### Cloud engines: the System One adapter

`createSystemOneHttpAdapter({ baseUrl, fetch?, apiKey?, engine?, preset?, timeoutMs?, maxStateChars? })`
returns a `Level1Engine` with `target: cloud_model` and `deterministic: false`.

- **Only a release, bound to the envelope.** `predict(request, release)` first checks that the
  release is a `DisclosureRelease` holding exactly the request's cards (id and content hash, in
  order), that its confirmation names the same cards and that every object still hashes to its
  content hash. Then it recomputes the envelope with `level1EnvelopeFor(engine, request,
  release.objects)` and requires `computePayloadHash(envelope) === release.confirmation.payloadHash`.
  Otherwise it throws `Level1EngineError('release_required')` and sends nothing. The body is built
  from `release.objects` (never from raw cards) and carries exactly the question, options and
  output schema of that envelope, so a confirmation for another connector, question, options,
  output schema or card set is worthless. Only links to released cards are sent. Neither check
  proves that the release is genuine or unspent: that is the service's
  `DisclosureGate.redeem` (single use, bound to the session).
- **The envelope.** `level1EnvelopeFor(engine, request, objects)` returns `{ target: 'cloud_model',
  connectorId: engine, request: { question, options, outputSchema }, objects }`.
  `DisclosureModelRequest.options` is a flat list, so `options` holds `<playerCardId>: <move>` for
  every move option of every player, players in request order, and `outputSchema` carries the full
  per-player structure (the move an enum of that player's options, `cardIds` an enum of the
  released ids). The service previews this envelope, the user confirms its hash, and the release
  from `redeem` goes unchanged to the adapter.
- **Content only.** The state text carries id, type, layer, title, date, source, body, player
  fields (not `personalityType`), the rule and the links. No `uri`, `externalId`, worlds, tags,
  class, visibility, release or training flag.
- **Request template (`generic-decide-v1`, `POST {baseUrl}/v1/decide`).**

  ```json
  {
    "instruction": "For each player named in the output schema, predict ...",
    "question": "Reroute laden tankers around the Cape for Q4?",
    "state": "[card 01M1E...] type: organisation, layer: said\nTitle: ...",
    "output_schema": {
      "type": "object",
      "properties": {
        "<playerCardId>": {
          "type": "object",
          "properties": {
            "predictedMove": { "type": "string", "enum": ["Keep ...", "Lift ..."] },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "cardIds": { "type": "array", "items": { "type": "string", "enum": ["<released card id>"] } }
          },
          "required": ["predictedMove", "confidence"]
        }
      },
      "required": ["<playerCardId>"]
    }
  }
  ```

  Answer: `{ "output": { "<playerCardId>": { "predictedMove", "confidence", "cardIds?" } },
  "confidence?": n }`; a top-level `confidence` fills entries without one.
- **Untrusted answers.** The move must be one of the options, the confidence a number in [0, 1],
  `cardIds` a list of released ids (the player card is added as the minimum), every requested
  player must be answered; anything else is `bad_response`. HTTP errors are reported by status
  only; neither the answer body nor the credential nor a transport error text is ever put into an
  error. The response is rejected early on a declared `content-length` above 1 MB, otherwise read
  with a 1 MB byte cap and cancelled when it grows past it; the body of an error response is
  cancelled unread. Redirects are not followed. `baseUrl` must be https (http only on loopback) and carry no
  credentials. Tests inject `fetch`; the package never touches the network by itself.
- **Presets.** A `SystemOneProviderPreset` (`id`, `defaultEngine`, `path`, `buildBody`,
  `readAnswers`) adapts another wire format; `GENERIC_SYSTEM_ONE_PRESET` and `JEV_PRESET` are
  built in. **The real Jev wire format is unconfirmed (owner decision OD-4).** `JEV_PRESET` is the
  generic template under the engine id `jev`; confirm or replace it before pointing the adapter at
  the real service. Any other "System One" provider can use the same template or a preset of its
  own.

Run `describeLevel1EngineConformance` against an adapter with an injected fake `fetch` to prove
it; the package's tests do this for both presets.

### Board display contract

`formatEstimate({ engine, predictedMove, confidence })` returns
`"<engine> estimates 0.82 for <move>"`: two decimals and never above 0.99 (1.00 would read as
certainty; display only), always with the engine, newlines and control characters collapsed, a
confidence outside [0, 1] rejected. `formatEstimates(prediction)` gives one
line per player. `apps/board` shows exactly this text next to each player card, marks it stale
when `isStale` is true, offers the cards used (`cardIds`) one click away and an "open as board"
action (the human-only `level1_escalate`, which uses `buildLevel2Draft`). It must not word an
estimate as an answer or add its own verdict. The panel is `apps/board/src/components/Level1Panel.tsx`;
it imports the formatter through the `@worldbuilder/level1-engines/format` subpath, which has no
runtime imports.

### Service seam

Implemented in `services/api` ([ADR-0045](../adr/0045-level1-service-seam.md)); the code is
`level1.ts` (request, what-if, escalation), `level1-engines.ts` (registry) and `level1-ops.ts`
(three human-only operations: `level1_get`, `level1_predict`, `level1_escalate`; none is an MCP
tool).

1. The `Level1PredictionRequest` is built from the Lage: the question, the players (actor, person
   and organisation cards placed on it, with `buildMoveOptions`), the placed cards and the user's
   rule cards that apply to it (no `worlds`, or a world in common; at most 50), each cleared by the
   gate. The built-in engine runs in the service and is cleared as the screen; a cloud engine is
   cleared as `cloud_model`. An assumption card the user rejected is left out; no stance and no
   pending proposal is ever included. A trigger keeps only assumption cards of the request, else
   it becomes `manual`. Lage edges are still not mapped into the request (follow-up).
2. A local run calls `engine.predict(request)` (`rerunOnAssumptionChange` for an assumption
   trigger). A cloud run is two calls of `level1_predict`: the first previews
   `level1EnvelopeFor(engine, request, cleared)` as a transfer (purpose `level1`) and answers
   `confirmation_required` with the whole envelope; after the human's `disclosure_confirm` the
   second carries `transferId` and the single-use token. The service refuses (409) if the envelope
   hash differs from the confirmed one, redeems once, and passes the release unchanged to
   `engine.predict(request, release)`. An engine failure is a 502 with fixed wording.
3. The latest prediction per Lage is kept in memory (`MAX_KEPT_PREDICTIONS`); a late answer (a
   newer call, or a board that changed while the engine ran, `currentOnly`) is `superseded` and
   dropped; `level1_get` reports `stale` with `isStale`. The board debounces (500 ms) and asks.
4. `level1_get?explain=true` adds the local engine's breakdown while the prediction is current;
   `level1_escalate` creates the level-2 Lage from `buildLevel2Draft` with a `based_on` edge to
   the source Lage.
5. Cloud engines are configured in `<state>/level1-engines.yaml`
   (`schemas/level1-engines.schema.json`): `id`, `preset` (`generic` or `jev`), `baseUrl`,
   `enabled`, optionally `apiKeyFile` (an owner-only file; the key is never in the YAML) and
   `timeoutMs`. None by default; the Jev preset is listed as unavailable until it is configured.

## DisclosureGate

Decides per card and per target what may leave the screen
([ADR-0012](../adr/0012-disclosure-gate.md),
[ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)).

| Member | Contract |
| --- | --- |
| `decide(item, target)` | default deny; a matching deny rule wins; invalid rules deny everything; stance data only for `screen`; never allows `cloud_model`; for `share` never a conclusion, and own experience or an external-source card only after the user's release ([ADR-0036](../adr/0036-conclusions-are-private.md)) |
| `preview(input)` | a cloud transfer: the envelope of gate-cleared objects, its RFC 8785 `payloadHash`, an expiry 5 minutes ahead; requested by the board or by an MCP connection |
| `confirm(input)` | human only, with the previewed hash; issues a single-use token (at least 128 bits, bound to the board session, 5 minutes) for board transfers, none for connection transfers |
| `redeem({ grant, envelope })` | consumes the token or the connection grant once, checks the envelope, and returns exactly the confirmed objects as a `DisclosureRelease` |
| `prepareShare(cards)` | a `ShareBundle`: the share projections (content, provenance and public descriptive fields) of the cards allowed for `share`, and the ids and reasons of the others; sends nothing |

Rules are data (`gate-rules.schema.json`); adapter fragments may only deny. Conformance:
`describeDisclosureGateConformance` from `@worldbuilder/conformance`; the reference gate in
`packages/disclosure-gate` passes it.

## LocalStateStore

Device-only state: proposals, stances, the gate decision log and the gate rules, as files in
the per-user state directory ([ADR-0030](../adr/0030-local-state-on-the-device.md)). The
service process is the only writer. The reference implementation is `packages/local-state`.

| Member | Contract |
| --- | --- |
| `createProposal(input, author)` | validates against `proposal.schema.json#/$defs/create`; stores a pending proposal with a new ULID id and `createdAt` |
| `getProposal(id)` / `listProposals(request)` | see cursor semantics below |
| `decideProposal(id, status)` | human only; `accepted` or `rejected`, records `decidedBy: human` and `decidedAt`; a decided proposal gives `conflict`, an unknown id `not_found` |
| `getStance(cardId)` / `listStances()` / `saveStance(cardId, input)` | one file per card; every change appends the previous version to `history` |
| `damagedFiles()` | names of proposal and stance files that are not JSON, fail their schema or whose inner id differs from the file name; they count nowhere and are skipped by listings |
| `appendGateLog(entry)` | one JSON line: `at` (ISO 8601 UTC), `cardId`, `item`, `target`, `decision`, a fixed `reason` code and an optional `ruleId`; never content. Rotates at 10 MB keeping 5 files (configurable) |
| `loadGateRules(fragments?)` | reads `gate-rules.yaml`, validates it and the adapter fragments; see below |

Cursor semantics ([ADR-0032](../adr/0032-m1-proposal-polling.md)): `cursor` and
`changedSince` both mean "changed after this cursor" (the later wins if both are given). A
proposal changes when it is created and again when it is decided. Results are ordered by
change, `nextCursor` is always returned (also for an empty page) and moves over changes that a
`status` or `lageId` filter hid, so polling with the returned cursor never skips or repeats a
change. Change stamps are strictly increasing; if the wall clock steps back they continue one
millisecond after the previous stamp.

Fail-closed loading ([ADR-0031](../adr/0031-gate-rules-and-confirmation-binding.md)): a rule
file or fragment that is unreadable, larger than 1 MiB, not valid YAML (aliases, duplicate
keys and several documents are refused), schema-invalid, has duplicate rule ids, or a
fragment that contains an allow rule, uses a reserved source (`user`, `fail-closed`) or
repeats a source, yields `ok: false`, the `reason`, and a deny-everything rule set. A missing
file is valid and means no rules, so default deny applies.

Gate log obligation: the caller maps every decision to a reason code (`default_deny`,
`rule_allow`, `rule_deny`, `stance_screen_only`, `invalid_rules`, `confirmation_required`,
`confirmed_transfer`, `connection_not_registered`) and passes the deciding rule's id as
`ruleId`. Free text is not accepted.

Error codes (`LocalStateError.code`): `invalid` (input or stored file fails its schema, bad
id, bad cursor), `not_found`, `conflict`, `unsafe_state_dir` (the directory is inside a store
root or Git working tree, or one of the state files is a symbolic link).

State directory helpers: `resolveStateDir` (per-OS default or an explicit absolute path; UNC
paths are refused on Windows) and `assertStateDirSafe`, both exported by the package.
