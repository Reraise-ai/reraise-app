# @worldbuilder/e2e

Playwright tests of the M1 walking skeleton: the built board, the built service (Board API and
`/mcp`), the `markdown-files` adapter on a temporary copy of the synthetic Hormuz store, and a
scripted MCP agent. Licence: AGPL-3.0-or-later.

```sh
pnpm test:e2e          # builds the workspace, then runs Playwright (Chromium)
```

Locally the browser is the one Playwright already has (`PLAYWRIGHT_BROWSERS_PATH`); never run
`playwright install` there. CI runs `npx playwright install --with-deps chromium` in this
directory (the pinned `@playwright/test` version, so the browser matches).

What the global setup does (`global-setup.ts`): copies `examples/hormuz` to a temporary store,
creates a temporary state directory with the gate rules of `support/gate-rules.ts`, registers a
`local_model` and a `cloud_model` agent with `worldbuilder agent add --token-file`, starts
`worldbuilder serve` on a free loopback port (allowing the board's origin) and serves
`apps/board/dist` with `vite preview` on another. Everything is removed afterwards; set
`WB_E2E_KEEP=1` to keep the temporary directory for inspection.

- `tests/walking-skeleton.spec.ts`: the scenario "hormuz walking skeleton".
- `tests/a11y.spec.ts`: axe-core on the main screens (no serious or critical violation).

The tests use the `data-testid` contract in `apps/board/README.md`. All specs share one service,
so they run in one worker; the walking skeleton changes the temporary store on purpose.
