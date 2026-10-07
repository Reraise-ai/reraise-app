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
- Usage metrics view (`usage_metrics_get`, human-only): targets from ADR-0041 in plain tables.

## Design tokens (ADR-0019)

Colours and fonts exist only in `src/tokens.css`. Components use `var(--wb-...)`.
`pnpm check:board-tokens` fails on hex, `rgb()`, `hsl()` and similar colour literals and on
`font-family` or `font` outside that file. It runs in CI and is row ADR-C09 in
`docs/verification.md`.

## Stable test ids for the e2e

These `data-testid` values are a contract: change them only together with the e2e. Ids ending in
`-<id>` carry a card, Lage, proposal or edge id.

| Area       | Test ids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login      | `login-form`, `login-base-url`, `login-token`, `login-submit`, `login-error`, `session-signout`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Navigation | `nav-boards`, `nav-usage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Lagen      | `lage-list`, `lage-list-error`, `lage-item-<id>`, `lage-open-<id>`, `lage-create-form`, `lage-create-title`, `lage-create-question`, `lage-create-options`, `lage-create-submit`                                                                                                                                                                                                                                                                                                                                         |
| Board      | `workbench`, `board-canvas`, `board-status`, `board-title`, `board-version`, `board-message`, `board-error`, `board-close`                                                                                                                                                                                                                                                                                                                                                                                               |
| Card node  | `card-node-<id>` (attributes `data-layer`, `data-selected`), `card-layer-<id>`, `card-author-<id>` (agent cards only), `card-stance-<id>` (your stance overlay)                                                                                                                                                                                                                                                                                                                                                          |
| Search     | `search-panel`, `search-input`, `search-submit`, `search-result-<id>`, `search-place-<id>`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Edges      | `edge-panel`, `edge-from`, `edge-to`, `edge-kind-select`, `edge-add`, `edge-row-<key>`, `edge-select-<key>`, `edge-kind-edit`, `edge-reverse`, `edge-delete`; on the canvas `edge-label-<key>`, `edge-author-<key>` (agent-drawn edges)                                                                                                                                                                                                                                                                                  |
| Proposals  | `proposals-panel`, `proposals-count`, `proposals-error`, `proposals-poll-error`, `proposal-<id>` (`data-status`), `proposal-author-<id>`, `proposal-kind-<id>`, `proposal-summary-<id>`, `proposal-applied-<id>` (the "What will be applied" block), `proposal-field-<id>-<field>`, `proposal-decision-<id>`, `proposal-scope-<id>` (a proposal for another Lage), `proposals-inbox` (the Lagen screen), `proposal-accept-<id>`, `proposal-reject-<id>`                                                                  |
| Inspector  | `inspector-panel`, `inspector-title`, `stance-form`, `stance-position`, `stance-weight`, `stance-note`, `stance-save`, `stance-status`                                                                                                                                                                                                                                                                                                                                                                                   |
| Context    | `context-panel`, `context-target`, `context-target-note`, `context-run`, `context-result`, `context-package`, `context-package-target`, `context-item-<id>`, `context-blocked`, `context-denied-<id>`, `context-independence`, `context-confirmation-required`, `context-cloud-warning`, `context-preview`, `context-envelope-target`, `context-envelope-connector`, `context-envelope-request`, `context-send-<id>`, `context-send-json-<id>`, `context-transfer`, `context-confirm`, `context-cancel`, `context-error` |
| Usage      | `usage-panel`, `usage-week`, `usage-week-hint`, `usage-error`, `usage-targets`, `usage-target-<targetId>` (`data-met`), `usage-value-<targetId>`, `usage-status-<targetId>`, `usage-details`, `usage-tasks`, `usage-accepted`, `usage-decisions`, `usage-atlas`, `usage-agents`, `usage-agent-<agent>`                                                                                                                                                                                                                   |

Target ids: `receipt_coverage_7d`, `agent_cards_7d`, `atlas_lag_hours`, `decisions_with_outcome`.
