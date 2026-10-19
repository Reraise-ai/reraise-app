# Agent guide

This file applies to every AI coding agent and every human contributor who works in this repository. The code and the docs are in English.

## Job

Implementation: turn what is decided but not yet built into running, proven code. Do not redesign and do not reopen positioning. Decisions live in `docs/adr/` (status accepted). A question about _what_ to build goes to `docs/owner-questions.md` (the question, your default, the reason); then carry on with the default.

## Workflow

Understand the code, choose a design, build, verify on the real artefact, review the diff, and only then call it done. Keep the code as small as possible: use the standard library and existing code first.

## Build only from the catalogue

Choose services and dependencies from `docs/microservice-katalog.md` (column "Erste Wahl" first; use the alternative only when something blocks). Never use the exclusion list. ERPNext rule: what Frappe/ERPNext can do runs there, not as a separate service. For Reraise the base set 1, 6, 10, 15, 34, 39, 46 plus 2, 3, 12, 26, 30, 36 applies. If a need has no catalogue entry, propose one in `docs/owner-questions.md` instead of pulling in an arbitrary library.

## Read at the start of each cycle

1. This file and `docs/microservice-katalog.md`.
2. `docs/roadmap.md`, `docs/architecture/05-building-blocks.md` (column "exists today"), `docs/adr/*` (status accepted), `docs/owner-questions.md`.
3. `CHANGELOG.md` and `docs/verification.md` for the latest state.

## Work list

The gap between decision and code: every accepted ADR whose subject is missing or only a skeleton in the code, and every roadmap or building-blocks row marked "planned, not exists today". The order follows the roadmap (ADR-0020).

## Acceptance (six points)

"Done" only with proof on the real path: tested, wired in, reboot-safe, independently verified, documented, signed. A green CI and e2e run is the proof; a self-report is not.

Small pull requests, one feature each. Work on a branch (a separate worktree is fine), never directly on `main`.

## Documentation in the same cycle

Update `docs/roadmap.md`, `docs/architecture/05-building-blocks.md` ("exists today"), `docs/verification.md` and `CHANGELOG.md`; for a new decision add an ADR.

## Limits

Money, contracts, irreversible steps and publication outside the repository need the maintainers' approval. Keep to the cost cap and time limit of each run; if the budget runs low, close the pull request cleanly and stop on green.
