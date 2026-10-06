# Verification

> Prove, don't claim. Every claim in the README and in these docs is backed by an automated
> test or a reproducible command. A criterion is "passing" only when its test exists and its
> CI job is green.

This table maps each acceptance criterion to the test that proves it, the CI job that runs
the test, and an honest status. It starts as a skeleton: almost everything is "not started".
The verifier maintains it as tests land.

Status values:

- **not started**: no test exists yet.
- **in progress**: work or a partial test exists, but the criterion is not fully proven.
- **passing**: the test exists, runs in CI and is green.
- **failing**: the test exists and is red.

Test files and CI jobs in the columns below are the *planned* locations. A cell reading
"not yet written" means no file exists yet, and the status stays "not started" until it does.

## M0: repository foundation and contracts

Milestone M0 is in progress. Its done criteria come from the [roadmap](./roadmap.md#m0-repository-foundation-and-contracts).

| ID | Criterion | Test file | CI job | Status |
| --- | --- | --- | --- | --- |
| M0-01 | CI is green on the main branch | all jobs in `.github/workflows/ci.yml` | `ci.yml` (all jobs) | in progress |
| M0-02 | Lint and format pass | `eslint.config.js`, Prettier configuration | `lint-format` | in progress |
| M0-03 | Typecheck passes in every package | package `tsconfig` files | `typecheck` | in progress |
| M0-04 | Unit tests run on Linux, Windows and macOS | `scripts/*.test.mjs`, package tests | `unit` | in progress |
| M0-05 | Every source file has an SPDX header matching its licence tier | `scripts/check-spdx.mjs` | `spdx` | in progress |
| M0-06 | No real data in the repository | `scripts/check-no-real-data.mjs` | `no-real-data` | in progress |
| M0-07 | JSON Schemas validate the synthetic examples | `scripts/validate-schemas.mjs` | schema validation job (added with the schemas) | not started |
| M0-08 | OpenAPI 3.1 contract lints | `schemas/openapi/` (being written) | OpenAPI lint job (added with the contract) | not started |
| M0-09 | The ADR log is complete for every binding decision | `docs/adr/` | docs build | in progress |
| M0-10 | The docs site builds with no dead links | `docs/.vitepress/config.mts` (`ignoreDeadLinks: false`) | `docs` | in progress |
| M0-11 | Dependency audit passes at high severity | `pnpm audit` | `audit` | in progress |

## M1: walking skeleton

| ID | Criterion | Test file | CI job | Status |
| --- | --- | --- | --- | --- |
| M1-01 | The Hormuz scenario (open Lage, place card, draw `supports` edge, agent proposes, human accepts, reload persists, context package, gate blocks a private card for cloud) runs end to end | `e2e/` (planned, Playwright) | `e2e` (planned) | not started |
| M1-02 | The reference `markdown-files` adapter passes the conformance kit | `packages/conformance` (planned) | `conformance` (planned) | not started |
| M1-03 | The first release waits until M1 passes on all three operating systems | release checklist | release workflow (planned) | not started |

## Acceptance criteria

These come from the [roadmap](./roadmap.md#mvp-critical-acceptance-criteria). "Milestone" is
the milestone in which the criterion is first expected to be demonstrated.

| ID | Criterion | Milestone | Test file | CI job | Status |
| --- | --- | --- | --- | --- | --- |
| AC-01 | The three layers (`evidenced`, `said`, `experience`) are never merged into one figure. Every number on the board decomposes into layers. | M1 | not yet written | not yet defined | not started |
| AC-02 | The user can classify any foreign statement with a private stance (`believed`, `rejected`, `undecided`, weight, note) without changing the card's layer. | M1 | not yet written | not yet defined | not started |
| AC-03 | The interface contains no verdict: no meter, no percentage, no highlighted "winning" option. The Rules panel lists fired and not fired rules with triggering cards only. | M2+ | not yet written | not yet defined | not started |
| AC-04 | The world's content types are visible and stored, including the user's own derivations and premises. | M1 | not yet written | not yet defined | not started |
| AC-05 | The world stays with the user: state is written to files and survives a reload and a restart. | M1 | not yet written | not yet defined | not started |
| AC-06 | Cards come from the user's own store through a `StorageAdapter`, and each card shows which system it came from. | M1 | not yet written | not yet defined | not started |
| AC-07 | The user can create a Lage with their own question and any number of options. | M1 | not yet written | not yet defined | not started |
| AC-08 | The user can draw, delete and reverse `supports` and `refutes` edges, and they persist. | M1 | not yet written | not yet defined | not started |
| AC-09 | A decision card stores all 11 sections and they survive a reload. | M2+ | not yet written | not yet defined | not started |
| AC-10 | Rules are explicit cards and evaluation reads from them, never from code. | M2+ | not yet written | not yet defined | not started |
| AC-11 | The outcome of a decision becomes a linked experience card, and source statistics update. | M2+ | not yet written | not yet defined | not started |
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
| AC-24 | The supporting infrastructure (API, storage, integrations) exists. | M1 | not yet written | not yet defined | not started |
| AC-25 | An external decision AI can be connected, at least as a stub behind the gate. | M2+ | not yet written | not yet defined | not started |
| AC-26 | Every world is private by default. A private card sent toward a cloud target is denied or warned about, and each cloud transfer needs confirmation. | M1 | not yet written | not yet defined | not started |
| AC-27 | The user can see and control which private cards leave the device, and the world stays outside the model. | M1 | not yet written | not yet defined | not started |
| AC-28 | Player entries (interests, capabilities, dependencies, moves) need a source, or are left empty. | M2+ | not yet written | not yet defined | not started |
| AC-29 | The independence count is derived from the provenance chain, never typed in. | M1 | not yet written | not yet defined | not started |
| AC-30 | A source pass is available on every card, seat, edge and decision. | M2+ | not yet written | not yet defined | not started |
| AC-31 | Provenance is mandatory for players, moves, assumptions and decisions, and imported cards keep their original provenance. | M2+ | not yet written | not yet defined | not started |
| AC-32 | The project exists as its own repository with CI. | M0 | not yet written | not yet defined | in progress |
| AC-33 | UX and architecture are separate documents with the links between them written down. | M0 | not yet written | not yet defined | in progress |
