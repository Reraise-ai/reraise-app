# @worldbuilder/level1-engines

Level-1 engines of The Worldbuilder ([ADR-0035](../../docs/adr/0035-level1-engine-socket.md)):
fast, attributed estimates of each player's next move, from the cards on a Lage.

- `createLocalRulesEngine()`: the default engine. Deterministic, local, no network. Scores move
  options from past moves, interests, capabilities, dependencies, red lines, assumed goals and the
  user's rule cards; confidence is a softmax at a documented temperature. `explain(request)`
  returns the breakdown.
- `rerunOnAssumptionChange`, `isStale`, `currentOnly`: the what-if re-run. A local engine re-runs
  by itself, a cloud engine never does.
- `buildLevel2Draft`: the body of `lage_create` for escalating a prediction to a board.
- `createSystemOneHttpAdapter`, `createJevAdapter`: a cloud engine over a generic `POST /v1/decide`.
  It accepts only a `DisclosureRelease`, takes an injected `fetch` and sends nothing otherwise.
  The real Jev wire format is unconfirmed (owner decision OD-4); this is a template.
- `formatEstimate`: "`<engine>` estimates 0.82 for `<move>`", for the board.

All engines run `describeLevel1EngineConformance` from `@worldbuilder/conformance`. The service
(`services/api`, [ADR-0045](../../docs/adr/0045-level1-service-seam.md)) and the board panel
(`apps/board`) use it; the board imports only `@worldbuilder/level1-engines/format`. See
[docs/reference/adapters.md](../../docs/reference/adapters.md#level-1-engines).

Licence: Apache-2.0.
