# @worldbuilder/board

Board app (React + Vite, `@xyflow/react` canvas). It is only a client of the Board API
(`schemas/openapi/board-api.yaml`): no store or state directory is read. The typed client
(`src/api/client.ts`) uses the generated contract types of `@worldbuilder/core`.

Licence: AGPL-3.0-or-later.

## Run

```sh
pnpm --filter @worldbuilder/board dev
```

Paste the session token that `worldbuilder serve` prints into the login form. It is kept in
`sessionStorage` (gone when the tab closes) and sent as `X-Worldbuilder-Session`. A 401 signs you
out.

## What the screen does

- Lagen: list, open, create (`cards_search type=lage`, `lage_create`, `lage_get`).
- Canvas: cards at their x/y, three visually distinct layers (evidenced, said, experience), your
  own stance as an overlay on screen only, the author on every agent-authored card.
- Search panel: place an existing card (`lage_save` with the version guard; a 409 reloads).
- Edge panel and canvas: draw, delete, reverse, change `supports` and `refutes` edges.
- Proposals panel: polls `proposal_list` every 2 s with `changedSince` and `nextCursor`
  (ADR-0032); accept or reject (human-only).
- Context package panel: target "Screen view of the package" (wire value `local_model`) or `cloud_model`; shows the gate result, denied
  ids, `confirmationRequired` and the cloud warning; a cloud transfer shows the whole envelope (target, connector, request, every field of every card) and needs your confirmation.
  The first option is named "Screen view of the package" because the board session is a screen caller: the service answers as `screen` and a registered local model gets its own package over its own connection. Until a target-specific preview exists the label does not promise a model-specific package (recorded in `docs/owner-questions.md`).
- Inspector: your stance (`stance_save`), never sent anywhere.
- Level 1 panel (`level1_get`, `level1_predict`, `level1_escalate`, all human-only): the button
  "Estimate next moves" asks an engine what each player (an actor card on the board) will probably
  do next. Per player it shows `formatEstimate` of `@worldbuilder/level1-engines` ("`<engine>`
  estimates 0.82 for `<move>`", never a verdict), the moves considered, the cards used (a click
  focuses the card on the board) and, on demand, the basis of the local engine. The local engine
  runs again by itself, 500 ms after the last change, when an assumption card on the board is
  placed, removed or edited or you change your stance on it (switch it off with the checkbox); a
  cloud engine never does: it shows the whole envelope and runs only after you click and confirm
  that one transfer. An estimate whose board has changed carries a "Stale" badge. "Escalate to
  board analysis" opens a new Lage for one player, linked to this one; the estimate itself is not
  copied. Estimates are not saved anywhere (OQ-27).
- Usage metrics view (`usage_metrics_get`, human-only): targets from ADR-0041 in plain tables.

## Design tokens (ADR-0019)

Colours and fonts exist only in `src/tokens.css`. Components use `var(--wb-...)`.
`pnpm check:board-tokens` fails on hex, `rgb()`, `hsl()` and similar colour literals and on
`font-family` or `font` outside that file. It runs in CI and is row ADR-C09 in
`docs/verification.md`.

## Stable test ids for the e2e

These `data-testid` values are a contract: change them only together with the e2e. Ids ending in
`-<id>` carry a card, Lage, proposal or edge id.

| Area       | Test ids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login      | `login-form`, `login-base-url`, `login-token`, `login-submit`, `login-error`, `session-signout`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Navigation | `nav-boards`, `nav-usage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Lagen      | `lage-list`, `lage-list-error`, `lage-item-<id>`, `lage-open-<id>`, `lage-create-form`, `lage-create-title`, `lage-create-question`, `lage-create-options`, `lage-create-submit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Board      | `workbench`, `board-canvas`, `board-status`, `board-title`, `board-version`, `board-message`, `board-error`, `board-close`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Card node  | `card-node-<id>` (attributes `data-layer`, `data-selected`), `card-type-<id>` (stored content type), `card-layer-<id>`, `card-author-<id>` (agent cards only), `card-stance-<id>` (your stance overlay)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Search     | `search-panel`, `search-input`, `search-submit`, `search-result-<id>`, `search-type-<id>`, `search-place-<id>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Edges      | `edge-panel`, `edge-from`, `edge-to`, `edge-kind-select`, `edge-add`, `edge-row-<key>`, `edge-select-<key>`, `edge-kind-edit`, `edge-reverse`, `edge-delete`; on the canvas `edge-label-<key>`, `edge-author-<key>` (agent-drawn edges)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Proposals  | `proposals-panel`, `proposals-count`, `proposals-error`, `proposals-poll-error`, `proposal-<id>` (`data-status`), `proposal-author-<id>`, `proposal-kind-<id>`, `proposal-summary-<id>`, `proposal-applied-<id>` (the "What will be applied" block), `proposal-field-<id>-<field>`, `proposal-decision-<id>`, `proposal-scope-<id>` (a proposal for another Lage), `proposals-inbox` (the Lagen screen), `proposal-accept-<id>`, `proposal-reject-<id>`                                                                                                                                                                                                                                                       |
| Inspector  | `inspector-panel`, `inspector-title`, `inspector-type`, `stance-form`, `stance-position`, `stance-weight`, `stance-note`, `stance-save`, `stance-status`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Context    | `context-panel`, `context-target`, `context-target-note`, `context-run`, `context-result`, `context-package`, `context-package-target`, `context-item-<id>`, `context-blocked`, `context-denied-<id>`, `context-independence`, `context-layer-<layer>`, `context-confirmation-required`, `context-cloud-warning`, `context-preview`, `context-envelope-target`, `context-envelope-connector`, `context-envelope-request`, `context-send-<id>`, `context-send-json-<id>`, `context-transfer`, `context-confirm`, `context-cancel`, `context-error`                                                                                                                                                             |
| Level 1    | `level1-panel`, `level1-engine`, `level1-run`, `level1-auto`, `level1-busy`, `level1-error`, `level1-note`, `level1-skipped`, `level1-preview`, `level1-envelope-connector`, `level1-envelope-request`, `level1-send-<id>`, `level1-confirm`, `level1-cancel`, `level1-results` (`data-stale`, `data-engine`), `level1-stale`, `level1-player-<id>`, `level1-estimate-<id>` (the `formatEstimate` text), `level1-changed-<id>`, `level1-option-<id>-<n>`, `level1-card-<id>-<id>` (player, card used; a click focuses the card), `level1-basis-toggle-<id>`, `level1-basis-<id>`, `level1-basis-note-<id>`, `level1-basis-option-<id>-<n>`, `level1-escalate-<id>`, `level1-analysis`, `level1-open-analysis` |
| Usage      | `usage-panel`, `usage-week`, `usage-week-hint`, `usage-error`, `usage-targets`, `usage-target-<targetId>` (`data-met`), `usage-value-<targetId>`, `usage-status-<targetId>`, `usage-details`, `usage-tasks`, `usage-accepted`, `usage-decisions`, `usage-atlas`, `usage-agents`, `usage-agent-<agent>`                                                                                                                                                                                                                                                                                                                                                                                                        |

Target ids: `receipt_coverage_7d`, `agent_cards_7d`, `atlas_lag_hours`, `decisions_with_outcome`.
