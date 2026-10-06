# Verification

> Prove, don't claim. Every claim in the README and in these docs is backed by an automated
> test or a reproducible command. A criterion is "passing" only when its test exists and its
> CI job is green.

This table maps each acceptance criterion to the test that proves it, the CI job that runs
the test, and an honest status. It starts as a skeleton: almost everything is "not started".
It is updated as tests land.

## Last local verification

**Date:** 2026-10-06  
**Platform:** Linux (Ubuntu)  
**Node:** v22.22.0  
**pnpm:** 10.28.0  
**Python:** 3.11.15

**Results:**
- lint: PASS
- format:check: PASS
- typecheck: PASS
- check:generated: PASS
- lint:openapi: PASS
- test:coverage: PASS
- check:spdx: PASS
- check:licence-imports: PASS
- check:no-real-data: PASS
- validate:schemas: PASS
- build: PASS
- audit: PASS
- reuse-lint: PASS
- gitleaks: PASS
- docs:build: PASS
- check:doc-anchors: PASS

**Note:** Windows and macOS platforms remain unverified until CI runs.

Status values:

- **not started**: no test exists yet.
- **in progress**: work or a partial test exists, but the criterion is not fully proven.
- **in progress (passes locally; no CI run yet)**: the check exists and passes on a developer machine, but CI has not run it on the main branch.
- **passing**: the test exists, runs in CI and is green.
- **failing**: the test exists and is red.

Test files and CI jobs named in the columns below are the real ones where they exist today, and the planned locations otherwise. A cell reading
"not yet written" means no file exists yet, and the status stays "not started" until it does.

## M0: repository foundation and contracts

Milestone M0 is in progress. Its done criteria come from the [roadmap](./roadmap.md#m0-repository-foundation-and-contracts).

| ID | Criterion | Test file | CI job | Status |
| --- | --- | --- | --- | --- |
| M0-01 | CI is green on the main branch | all jobs in `.github/workflows/ci.yml` | `lint-format`, `typecheck`, `checks`, `audit`, `reuse`, `gitleaks` | in progress (no CI run yet) |
| M0-02 | Lint and format pass | `eslint.config.js`, Prettier configuration | `lint-format` | in progress (passes locally; no CI run yet) |
| M0-03 | Typecheck passes in every package and in the scripts | package `tsconfig` files, `tsconfig.scripts.json` | `typecheck` | in progress (passes locally; no CI run yet) |
| M0-04 | Unit tests run on Linux, Windows and macOS | `scripts/*.test.mjs`, package tests | `checks` (matrix over three operating systems) | in progress (passes locally; no CI run yet) |
| M0-05 | Coverage gate on `packages/core` (90 % lines, 90 % functions, 85 % branches, 90 % statements) | `vitest.config.ts` thresholds | `checks` (`pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| M0-06 | JSON Schemas validate the synthetic examples | `scripts/validate-schemas.test.mjs` (runs `scripts/validate-schemas.mjs` over `schemas/`, `schemas/fixtures/` and `examples/`), `scripts/contracts.test.mjs`, `scripts/markdown-cards.test.mjs`, `scripts/generate-types.test.mjs` | `checks` (`pnpm validate:schemas`, `pnpm test:coverage`), `typecheck` (`pnpm check:generated`) | in progress (passes locally; no CI run yet) |
| M0-07 | OpenAPI 3.1 contract lints and contract tests | `schemas/openapi/board-api.yaml` linted by `scripts/lint-openapi.mjs`; parity and security tests in `packages/mcp-server/src/tools.test.ts`; adapter kits in `packages/conformance/src/*.ts` run by `packages/conformance/src/index.test.ts` and `packages/disclosure-gate/src/index.test.ts` | `lint-format` (`pnpm lint:openapi`), `checks` (`pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| M0-08 | The ADR log is complete for every binding decision | `docs/adr/` (ADR-0001 onwards) | `build` in `docs.yml` builds it | in progress (passes locally; no CI run yet) |
| M0-09 | The docs site builds with no dead links or broken anchors | `docs/.vitepress/config.mts` (`ignoreDeadLinks: false`), `scripts/check-doc-anchors.mjs` | `build` in `docs.yml` | in progress (passes locally; no CI run yet) |
| M0-10 | Dependency audit passes at high severity | `pnpm audit --audit-level high` | `audit` | in progress (passes locally; no CI run yet) |
| M0-11 | Dependabot is configured for npm and GitHub Actions | `.github/dependabot.yml` | none (GitHub-side service) | in progress (configured; no run yet) |
| M0-12 | Accessibility check (axe) on the board | none | none | not started (planned from M1) |

## M1: walking skeleton

| ID | Criterion | Test file | CI job | Status |
| --- | --- | --- | --- | --- |
| M1-01 | The Hormuz scenario (open Lage, place card, draw `supports` edge, agent proposes, human accepts, reload persists, context package, gate blocks a private card for cloud) runs end to end | `e2e/` (planned, Playwright) | `e2e` (planned) | not started |
| M1-02 | The reference `markdown-files` adapter passes the conformance kit | `packages/adapters/storage-markdown-files/src/conformance.test.ts` (kit over a temporary copy of the Hormuz store without its cards), `hormuz.test.ts` (the complete store), `adapter.test.ts`, `codec.test.ts`, `frontmatter.test.ts`, `lock.test.ts` | `checks` (`pnpm test`, `pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| M1-03 | The first release waits until M1 passes on all three operating systems | release checklist | release workflow (planned) | not started |

## Checks promised by the ADRs

These are the automated checks the [ADRs](./adr/) commit to. "Passing" means the check
exists today with a test and runs in a CI job in `.github/workflows/ci.yml`. Everything else is
not started, and the status says so.

| ID | Promise | ADR | Test or script | CI job | Status |
| --- | --- | --- | --- | --- | --- |
| ADR-C01 | Every source file has an SPDX header matching its licence tier (Apache-2.0 or AGPL-3.0-or-later) | [0004](./adr/0004-two-tier-licensing.md) | `scripts/check-spdx.mjs`, tested by `scripts/check-spdx.test.mjs` | `checks` (`pnpm check:spdx`; the test runs in `pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| ADR-C02 | No real data: IBAN, tax-ID, passport-like, e-mail outside the allow-list, private IP, unmarked data files | [0022](./adr/0022-public-hygiene.md) | `scripts/check-no-real-data.mjs` (e-mail and IBAN patterns shared from `packages/core/src/personal-data.ts`), tested by `scripts/check-no-real-data.test.mjs` | `checks` (`pnpm check:no-real-data`) | in progress (passes locally; no CI run yet) |
| ADR-C03 | Secret scanning of the full git history | [0022](./adr/0022-public-hygiene.md) | no test file: a pinned gitleaks CLI in the workflow | `gitleaks` | in progress (job exists; no CI run yet) |
| ADR-C04 | REUSE compliance (licence and copyright annotations for every file) | [0004](./adr/0004-two-tier-licensing.md) | `reuse lint` (pinned version) | `reuse` | in progress (passes locally; no CI run yet) |
| ADR-C05 | JSON Schemas validate valid and invalid synthetic examples | [0023](./adr/0023-core-domain-model.md), [0028](./adr/0028-json-schema-contract-conventions.md) | `scripts/validate-schemas.test.mjs`: every schema compiles in Ajv strict mode, every example and valid fixture passes, every invalid fixture fails with its declared error or cross-check | `checks` (`pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C06 | Dependency audit at high severity | [0025](./adr/0025-engineering-process-and-quality-gates.md) | `pnpm audit --audit-level high` | `audit` | in progress (passes locally; no CI run yet) |
| ADR-C07 | Apache-licensed packages never import AGPL-licensed packages | [0003](./adr/0003-typescript-monorepo-stack.md), [0004](./adr/0004-two-tier-licensing.md) | `scripts/check-licence-imports.mjs`, tested by `scripts/check-licence-imports.test.mjs` | `checks` (`pnpm check:licence-imports`) | in progress (passes locally; no CI run yet) |
| ADR-C08 | DCO sign-off on every commit and Conventional Commit titles | [0025](./adr/0025-engineering-process-and-quality-gates.md) | not written | not defined | not started |
| ADR-C09 | No hex colours or hard-coded fonts in `apps/board` (design tokens only) | [0019](./adr/0019-design-tokens-and-board-canvas.md) | not written | not defined | not started |
| ADR-C10 | MCP tools and HTTP Board API stay in parity | [0016](./adr/0016-mcp-first-and-openapi-contracts.md) | `packages/mcp-server/src/tools.test.ts` (same operationId, input and output schemas per tool) | `checks` (`pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| ADR-C11 | Markdown lint and link check | [0025](./adr/0025-engineering-process-and-quality-gates.md) | the docs build fails on dead links (`ignoreDeadLinks: false`) and on broken anchors. markdownlint is configured for `docs/adr` only and is not a CI job yet. | `build` in `docs.yml` | in progress (link and anchor check only) |
| ADR-C12 | `rules_evaluate` result has no numeric score field | [0013](./adr/0013-rules-panel-replaces-barometer.md) | `scripts/contracts.test.mjs` (no verdicts), fixtures `schemas/fixtures/invalid/rule-evaluation-*.json` | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C13 | Default deny for every target and stances denied except for `screen` | [0012](./adr/0012-disclosure-gate.md) | `packages/conformance/src/disclosure-gate.ts` run against the reference gate by `packages/disclosure-gate/src/index.test.ts` | `checks` (`pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| ADR-C14 | MCP has no writing tool except the four that create proposals (`proposal_create`, `knowledge_write_back`, `decision_record`, `decision_outcome`); accept and reject reject agent credentials | [0011](./adr/0011-agent-moves-are-proposals.md), [0026](./adr/0026-security-defaults.md), [0039](./adr/0039-knowledge-loop-receipts.md) | contract level: `packages/mcp-server/src/tools.test.ts` (only the proposal-creating tools are not read-only, and each returns or carries a proposal; human-only operations accept the session token only and declare 403). Runtime: `services/api/src/security.test.ts` (every human-only operation answers 403 to agent tokens, `proposal_create` answers 403 to the session token, unregistered tokens are 401) | `checks` (`pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| ADR-C15 | Default bind address is loopback | [0026](./adr/0026-security-defaults.md) | `services/api/src/security.test.ts` (binds `127.0.0.1` by default and answers over a real socket; foreign `Host` and `Origin` rejected) | `checks` (`pnpm test`) | in progress (passes locally; no CI run yet) |
| ADR-C16 | A decision without `training: true` (or with an open outcome) produces no training trace; cards that did not opt in never appear, not even by id; agent free text (rationales, comments, proposed outcomes) is never exported | [0017](./adr/0017-decision-card-and-training-export.md), [0039](./adr/0039-knowledge-loop-receipts.md) | schema level: `schemas/fixtures/invalid/training-export-*.json` and the `training-opt-in` cross-check in `scripts/validate-schemas.mjs`; builder: `packages/training-export/src/build.test.ts` (runs the same cross-check over its output). The export egress with confirmation is a service slice | `checks` (`pnpm validate:schemas`, `pnpm test:coverage`) | in progress (builder and schema level pass locally; no CI run yet; export egress not written) |
| ADR-C17 | The stdio bridge writes no files and opens no store or state file (spy-based test), relays `Mcp-Session-Id` and streams, and takes its token from an environment variable or file only; `/mcp` rejects a foreign `Host` or disallowed `Origin`; `/mcp` and the bridge return the same results | [0029](./adr/0029-process-topology.md) | not written | not defined | not started |
| ADR-C18 | Local state is written only in the state directory; its default is the per-OS directory; the service refuses to start when it is inside a store root or a Git working tree; the gate log contains no card content; the stance endpoint rejects agent tokens | [0030](./adr/0030-local-state-on-the-device.md) | `packages/local-state/src/*.test.ts` (store, state-dir, gate-log, gate-rules); service level: `services/api/src/security.test.ts` (refusal to start inside a store root or a Git working tree, also through a symlink; stance endpoints reject agent tokens) and `services/api/src/disclosure.test.ts` (gate log holds fixed reason codes and no card content). The MCP side (no stance tool) is part of the MCP slice | `pnpm test`| in progress (passes locally; no CI run yet; MCP part pending)|
| ADR-C19 | Gate rules: deny wins, an invalid rule file denies everything, adapter fragments cannot override a deny. Cloud confirmation: send rejected after a change of engine, question, options, output schema or cards; confirm rejected on a preview/confirm hash mismatch; replayed, expired or foreign tokens rejected | [0031](./adr/0031-gate-rules-and-confirmation-binding.md) | `packages/conformance/src/disclosure-gate.ts` against the reference gate (`packages/disclosure-gate/src/index.test.ts`); schema fixtures `schemas/fixtures/*/gate-rules-*.json` and `disclosure-*.json`. Service level: `services/api/src/disclosure.test.ts` (cloud context package without confirmation has no content; edit after preview or after confirmation, changed question, replay, concurrent sends, expiry, foreign connection, restart and rule change all void or refuse the transfer) | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C20 | `proposal_list` has the same `changedSince` parameter and `nextCursor` result on MCP and HTTP, for both token kinds; no proposal is missed or repeated across polls | [0032](./adr/0032-m1-proposal-polling.md) | contract level: `packages/mcp-server/src/tools.test.ts` (parity of `proposal_list`); polling behaviour: `services/api/src/proposals.test.ts` (no proposal missed or repeated, both token kinds) | `checks` (`pnpm test:coverage`) | in progress (passes locally; no CI run yet; MCP side with the MCP slice) |
| ADR-C21 | The derived index rebuilt from the files gives identical query results and follows external file changes | [0033](./adr/0033-derived-index-reference-adapter.md), confirmations of [0006](./adr/0006-files-are-the-truth.md) (archive-on-rewrite keeps every version; rebuilt index gives identical results; `contentHash` stable) | `packages/adapters/storage-markdown-files/src/adapter.test.ts` ("rebuilds to identical query results", "picks up files changed, added and removed behind its back", "refreshes the index from file system events", "never overwrites a version"), `hormuz.test.ts` ("rewrites the Lage with a new version and archives the previous one"), `conformance.test.ts` (archive, Lage version, content-hash tests of the kit) | `checks` (`pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| ADR-C22 | A level-1 engine predicts per player a move out of the player's options, with confidence in [0, 1], names only cards of the request, refuses as a cloud engine without exactly the confirmed release, and is deterministic when it says so | [0035](./adr/0035-level1-engine-socket.md) | `packages/conformance/src/level1-engine.ts` (`describeLevel1EngineConformance`, `level1PredictionProblems`) run against the fake engine by `packages/conformance/src/level1-engine.test.ts`; fixtures `schemas/fixtures/*/level1-*.json` with the cross-checks `level1-move` and `level1-players`. The deterministic local engine is the slice after M1 | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C23 | Conclusions are never shared: for `share` the gate denies decisions, rules, ratings, assumptions, agent output and cards without a public external source whatever the rules say; own experience only after release; external-source cards only after release and an allow rule, as content and provenance only; decision and rule cards reach a cloud model only through a confirmed transfer | [0036](./adr/0036-conclusions-are-private.md) | `packages/conformance/src/disclosure-gate.ts` against the reference gate (`packages/disclosure-gate/src/index.test.ts`); `packages/core/src/sharing.test.ts`; fixtures `schemas/fixtures/*/card-shared-*.json`, `share-bundle*.json`, `disclosure-*share*.json`, `context-package-for-share.json`, `proposal-create-card-released.json` | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C24 | Agent connections are registered one by one with a name, a target class and a token hash only; `/mcp` rejects unknown and revoked tokens; no tool registers a connection | [0037](./adr/0037-hermes-agents-as-mcp-clients.md) | schema level: `schemas/fixtures/*/agent-connections*.json` and the cross-check `agent-names`; the registry and the runtime checks come with the M1 service | `checks` (`pnpm validate:schemas`) | in progress (schema level passes locally; service in M1) |
| ADR-C25 | Red lines, assumed goals and a personality type: sourced entries, on actors only, the personality type only on persons and never shared; adapters round-trip them | [0038](./adr/0038-player-fields-red-lines-goals-personality.md) | fixtures `schemas/fixtures/invalid/card-red-line-*.json`, `card-assumed-goal-*.json`, `card-personality-type-*.json`; `scripts/markdown-cards.test.mjs`; storage conformance kit run by `packages/conformance/src/index.test.ts` | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C26 | Knowledge and Write-back Receipts carry ids, hashes, codes and times only, never content; the query hash is keyed with the device receipt key (HMAC-SHA256); `taskRef` is opaque (no spaces, no `//`); each receipt's hash is the JCS hash of its content; agent drafts cannot release a card or opt it in to training; the five knowledge-loop tools exist with HTTP mirrors of the same schemas, and the receipt and proposal tools accept agent tokens only | [0039](./adr/0039-knowledge-loop-receipts.md) | `packages/knowledge-loop/src/receipts.test.ts` (marker text never in a receipt; HMAC vectors of RFC 4231), `log.test.ts` (device key created once); `scripts/contracts.test.mjs` (no free-text field); fixtures `schemas/fixtures/*/knowledge-*.json`, `write-back-*.json`, `api-decision-*.json`, `proposal-*opted-in*.json`, `proposal-record-outcome*.json` and the cross-check `receipt-hash`; `packages/mcp-server/src/tools.test.ts` | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (contracts and library pass locally; no CI run yet; service wiring not written) |
| ADR-C27 | The receipt log is append-only and hash-chained; an edited, inserted, deleted or reordered entry before the last, an edited receipt, a broken last line and a duplicate receipt are detected; removing or consistently rewriting whole entries at the end is detected only against a pinned head (`--head`); a broken log is never extended and the writer refuses a duplicate receipt; the verifier fails closed with the documented codes, including `invalid_time` for times that cannot be represented; `wb receipts verify` returns exit codes 0, 1, 2 and 3 as documented | [0040](./adr/0040-receipt-log-and-verifier.md) | `packages/knowledge-loop/src/log.test.ts`, `verify.test.ts`, `cli.test.ts`; fixtures `schemas/fixtures/*/receipt-log-entry-*.json`, `task-record*.json` | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C28 | Usage metrics follow the formulas of the ADR per agent and ISO week (UTC) and over the rolling 7 days; `agent_cards_7d` counts accepted agent cards; the atlas lag compares the existing pages with the expected ones (missing and extra pages are stale; a stale page without a usable time makes the lag unknown); targets are overridable defaults; a target without evidence is not met; the document validates against its schema; `wb metrics` exit codes as documented | [0041](./adr/0041-usage-ledger-and-metrics.md) | `packages/knowledge-loop/src/metrics.test.ts`, `cli.test.ts`; fixtures `schemas/fixtures/*/usage-metrics-*.json`, `api-usage-metrics-*.json`. The Board API route and the board panel are a service slice | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (library passes locally; no CI run yet; route and panel not written) |
| ADR-C29 | `memory_route` is deterministic with the ordered rules `rules:v3`; secrets (also with words before the value, quoted, or base64 with `/`, lower-case runs with many digits, or a known service prefix) and personal data (e-mail, phone, IBAN) never route to a card proposal; a private address wins over a public link; the result names signal ids, never the matched words | [0042](./adr/0042-memory-route-classification.md) | `packages/knowledge-loop/src/route.test.ts` (synthetic corpus with every rule and every review case); `packages/core/src/personal-data.test.ts` (patterns shared with the no-real-data check); fixtures `schemas/fixtures/*/memory-route-*.json` | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C30 | Atlas pages are deterministic, every line cites card ids that are sources of the page, staleness reports changed, removed and added cards, `--check` reports missing and extra pages, regeneration removes generated pages the current rules no longer produce (other files untouched), the gate filters cards for the target, and `wb digest` refuses `cloud_model` and `share` | [0043](./adr/0043-digest-atlas-regeneration.md) | `packages/knowledge-loop/src/digest.test.ts`, `cli.test.ts` (against a copy of the synthetic Hormuz store, including a tightened rule); fixtures `schemas/fixtures/*/digest-page*.json` and the cross-check `digest-lines` | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (passes locally; no CI run yet) |
| ADR-C31 | Accepting a `record_outcome` proposal patches only `sections.outcome` of the decision card, only when its content hash equals `expectedContentHash` (conflict otherwise), and never `release`, `training` or other metadata | [0039](./adr/0039-knowledge-loop-receipts.md) | schema level only: `schemas/fixtures/*/proposal-record-outcome*.json`, `api-decision-outcome-*.json`; the accept semantics are not written (service slice) | not defined | not started (schema level passes locally; accept path not written) |

## Acceptance criteria

These come from the [roadmap](./roadmap.md#mvp-critical-acceptance-criteria). "Milestone" is
the milestone in which the criterion is first expected to be demonstrated.

| ID | Criterion | Milestone | Test file | CI job | Status |
| --- | --- | --- | --- | --- | --- |
| AC-01 | The three layers (`evidenced`, `said`, `experience`) are never merged into one figure, and a stance is never folded into a layer or a count. Every number on the board decomposes into layers. | M1 | not yet written | not yet defined | not started |
| AC-02 | The user can classify any foreign statement with a private stance (`believed`, `rejected`, `undecided`, weight, note) without changing the card's layer. | M1 | not yet written | not yet defined | not started |
| AC-03 | The interface contains no verdict: no meter, no percentage, no highlighted "winning" option. The Rules panel lists fired and not fired rules with triggering cards only. | M2+ | not yet written | not yet defined | not started |
| AC-04 | The world's content types are visible and stored, including the user's own derivations and premises. | M1 | not yet written | not yet defined | not started |
| AC-05 | The world stays with the user: state is written to files and survives a reload and a restart. | M1 | not yet written | not yet defined | not started |
| AC-06 | Cards come from the user's own store through a `StorageAdapter`, and each card shows which system it came from. | M1 | not yet written | not yet defined | not started |
| AC-07 | The user can create a Lage with their own question and any number of options. | M1 | not yet written | not yet defined | not started |
| AC-08 | The user can draw, delete and reverse `supports` and `refutes` edges (both in M1), and they persist. | M1 | not yet written | not yet defined | not started |
| AC-09 | A decision card stores all 11 sections and they survive a reload. | M2+ | not yet written | not yet defined | not started |
| AC-10 | The user creates and changes rule cards, and evaluation reads from those cards, never from code. | M2+ | not yet written | not yet defined | not started |
| AC-11 | Recording an outcome creates an experience card linked to the decision and to the cards used, it survives a reload, and source statistics update. | M2+ | not yet written | not yet defined | not started |
| AC-12 | A decision protocol exists across sessions, not only for the current one. | M2+ | not yet written | not yet defined | not started |
| AC-13 | The rationale of a decision is stored. | M2+ | not yet written | not yet defined | not started |
| AC-14 | The model is replaceable: each target is backed by a real connector, and switching it changes only the connector. | M2+ | not yet written | not yet defined | not started |
| AC-15 | The Worldbuilder is a layer a model can query. It is more than text to copy. | M1 | not yet written | not yet defined | not started |
| AC-16 | A database stores, an API supplies context, a model answers, and all three exist. | M1 | not yet written | not yet defined | not started |
| AC-17 | A model's answer returns to the board or the decision card as a proposal. | M2+ | not yet written | not yet defined | not started |
| AC-18 | The context pipeline selects relevant cards (request, active world, cards, relations, decisions, provenance, package) and hands over to a real target. | M1 | not yet written | not yet defined | not started |
| AC-19 | Relevance is chosen by the system from rules and cards, and a model can ask which assumptions, experiences and rules are relevant. | M2+ | not yet written | not yet defined | not started |
| AC-20 | The interface is model-independent. Several targets exist, and a user can add one. | M2+ | not yet written | not yet defined | not started |
| AC-21 | An agent queries the world itself (through MCP) and the user does not re-enter it. | M1 | not yet written | not yet defined | not started |
| AC-22 | Single cards can be added to and removed from a context package by the user. | M1 | not yet written | not yet defined | not started |
| AC-23 | A board API exists and the board is only a client of it. | M1 | `services/api/src/contract.test.ts` (every operation of the OpenAPI contract is called and its response validated against the contract; a final test fails if one is not); the board client is a later slice | `checks` (`pnpm test`) | in progress (API passes locally; no CI run yet; board client pending) |
| AC-24 | The supporting infrastructure exists: API, storage and integrations (M1). Analytics (source statistics) arrive with the source-profile slice (M2+). Authentication is the local session token and per-agent tokens of [ADR-0026](./adr/0026-security-defaults.md); user accounts are deferred to platform work. | M1 | not yet written | not yet defined | not started |
| AC-25 | An external decision AI can be connected, at least as a stub behind the gate. | M2+ | not yet written | not yet defined | not started |
| AC-26 | Every world is private by default. The gate denies a private card for `cloud_model` by default; a cloud transfer happens only for gate-cleared cards and after the user confirms that transfer; the preview shows a cloud warning. | M1 | service side: `services/api/src/disclosure.test.ts` (private card blocked for `cloud_model`, transfer only after confirmation); the preview warning is board UI and not yet written | `checks` (`pnpm test`) | in progress (service part passes locally; no CI run yet; UI part not started) |
| AC-27 | The user can see and control which private cards leave the device, and the world stays outside the model. | M1 | not yet written | not yet defined | not started |
| AC-28 | Player entries (interests, capabilities, dependencies, moves) need a source, or are left empty. | M2+ | not yet written | not yet defined | not started |
| AC-29 | The independence count is derived from the provenance chain, never typed in. | M1 | not yet written | not yet defined | not started |
| AC-30 | A source pass is available on every card, seat, edge and decision. | M2+ | not yet written | not yet defined | not started |
| AC-31 | Provenance is mandatory for players, moves, assumptions and decisions, and imported cards keep their original provenance. | M2+ | not yet written | not yet defined | not started |
| AC-32 | The project exists as its own repository with CI. | M0 | not yet written | not yet defined | in progress |
| AC-33 | UX and architecture are separate documents with the links between them written down. | M0 | link table in `docs/architecture/index.md`; dead links and anchors fail `pnpm docs:build` and `pnpm check:doc-anchors` | `build` in `docs.yml` | in progress (passes locally; no CI run yet) |

## Known follow-ups from review (non-blocking)

Items to address targeting M1 (not started):

- **gate: expired transfer/token returns `unknown` (409) instead of `expired` (410) because pruning runs first** - The gate's pruning step runs before classifying tokens, causing expired tokens to report as unknown. This needs reordering so expired is identified before pruning.

- **validate-schemas: cross-check canonical URI (`buildUri(parseUri(uri)) === uri`) and id/externalId consistency for fixtures** - Schema fixtures should validate that URI parsing and building round-trip correctly, and that id and externalId fields remain consistent.

- **training opt-in scan only matches upper-case ULIDs in free text** - The training-opt-in check needs to handle both upper and lower-case ULIDs when scanning for decision references in free text.

- **unconfirmed cloud context package may carry non-zero independence counts (counts only)** - An unconfirmed cloud package should not carry independence counts, or if it does, this needs to be explicitly validated. Currently only counts are affected.

- **storage conformance legacy-stance mapping tests are optional; owner-store adapter must provide believedCard and assessmentOnlyCard** - The conformance suite needs optional tests for legacy stance mapping, and the owner-store adapter implementation must ensure it provides believedCard and assessmentOnlyCard fixtures.

- **concurrent-send race test, restart voiding, runtime agent-token 403s, proposal polling behaviour: need the M1 service** - These runtime behaviors cannot be tested in M0 without the service running; they are planned for the M1 integration test suite.
