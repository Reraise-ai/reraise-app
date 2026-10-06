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
| M1-02 | The reference `markdown-files` adapter passes the conformance kit | `packages/conformance` (planned) | `conformance` (planned) | not started |
| M1-03 | The first release waits until M1 passes on all three operating systems | release checklist | release workflow (planned) | not started |

## Checks promised by the ADRs

These are the automated checks the [ADRs](./adr/) commit to. "Passing" means the check
exists today with a test and runs in a CI job in `.github/workflows/ci.yml`. Everything else is
not started, and the status says so.

| ID | Promise | ADR | Test or script | CI job | Status |
| --- | --- | --- | --- | --- | --- |
| ADR-C01 | Every source file has an SPDX header matching its licence tier (Apache-2.0 or AGPL-3.0-or-later) | [0004](./adr/0004-two-tier-licensing.md) | `scripts/check-spdx.mjs`, tested by `scripts/check-spdx.test.mjs` | `checks` (`pnpm check:spdx`; the test runs in `pnpm test:coverage`) | in progress (passes locally; no CI run yet) |
| ADR-C02 | No real data: IBAN, tax-ID, passport-like, e-mail outside the allow-list, private IP, unmarked data files | [0022](./adr/0022-public-hygiene.md) | `scripts/check-no-real-data.mjs`, tested by `scripts/check-no-real-data.test.mjs` | `checks` (`pnpm check:no-real-data`) | in progress (passes locally; no CI run yet) |
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
| ADR-C14 | MCP has no writing tool except `proposal_create`; accept and reject reject agent credentials | [0011](./adr/0011-agent-moves-are-proposals.md), [0026](./adr/0026-security-defaults.md) | contract level: `packages/mcp-server/src/tools.test.ts` (only `proposal_create` is not read-only; human-only operations accept the session token only and declare 403). The runtime rejection is tested with the service in M1 | `checks` (`pnpm test:coverage`) | in progress (contract passes locally; runtime test in M1) |
| ADR-C15 | Default bind address is loopback | [0026](./adr/0026-security-defaults.md) | not written | not defined | not started |
| ADR-C16 | A decision without `training: true` produces no training trace | [0017](./adr/0017-decision-card-and-training-export.md) | schema level: `schemas/fixtures/invalid/training-export-*.json` and the `training-opt-in` cross-check in `scripts/validate-schemas.mjs`; the exporter itself is an M2 slice | `checks` (`pnpm validate:schemas`) | in progress (schema level passes locally; exporter not written) |
| ADR-C17 | The stdio bridge writes no files and opens no store or state file (spy-based test), relays `Mcp-Session-Id` and streams, and takes its token from an environment variable or file only; `/mcp` rejects a foreign `Host` or disallowed `Origin`; `/mcp` and the bridge return the same results | [0029](./adr/0029-process-topology.md) | not written | not defined | not started |
| ADR-C18 | Local state is written only in the state directory; its default is the per-OS directory; the service refuses to start when it is inside a store root or a Git working tree; the gate log contains no card content; the stance endpoint rejects agent tokens | [0030](./adr/0030-local-state-on-the-device.md) | not written | not defined | not started |
| ADR-C19 | Gate rules: deny wins, an invalid rule file denies everything, adapter fragments cannot override a deny. Cloud confirmation: send rejected after a change of engine, question, options, output schema or cards; confirm rejected on a preview/confirm hash mismatch; replayed, expired or foreign tokens rejected | [0031](./adr/0031-gate-rules-and-confirmation-binding.md) | `packages/conformance/src/disclosure-gate.ts` against the reference gate (`packages/disclosure-gate/src/index.test.ts`); schema fixtures `schemas/fixtures/*/gate-rules-*.json` and `disclosure-*.json`. Restart and concurrent-send tests need the service (M1) | `checks` (`pnpm test:coverage`, `pnpm validate:schemas`) | in progress (contract passes locally; service tests in M1) |
| ADR-C20 | `proposal_list` has the same `changedSince` parameter and `nextCursor` result on MCP and HTTP, for both token kinds; no proposal is missed or repeated across polls | [0032](./adr/0032-m1-proposal-polling.md) | contract level: `packages/mcp-server/src/tools.test.ts` (parity of `proposal_list`); polling behaviour is tested with the service in M1 | `checks` (`pnpm test:coverage`) | in progress (contract passes locally; behaviour in M1) |
| ADR-C21 | The derived index rebuilt from the files gives identical query results and follows external file changes | [0033](./adr/0033-derived-index-reference-adapter.md) | not written | not defined | not started |

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
| AC-23 | A board API exists and the board is only a client of it. | M1 | not yet written | not yet defined | not started |
| AC-24 | The supporting infrastructure exists: API, storage and integrations (M1). Analytics (source statistics) arrive with the source-profile slice (M2+). Authentication is the local session token and per-agent tokens of [ADR-0026](./adr/0026-security-defaults.md); user accounts are deferred to platform work. | M1 | not yet written | not yet defined | not started |
| AC-25 | An external decision AI can be connected, at least as a stub behind the gate. | M2+ | not yet written | not yet defined | not started |
| AC-26 | Every world is private by default. The gate denies a private card for `cloud_model` by default; a cloud transfer happens only for gate-cleared cards and after the user confirms that transfer; the preview shows a cloud warning. | M1 | not yet written | not yet defined | not started |
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
