---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0025: Engineering process and quality gates

## Context and Problem Statement

The repository is public, built by humans and several agents in parallel,
and every feature claim must be backed by a test or a reproducible demo.
The hand-over sets repository standards (commits, versioning, branching,
docs structure, CI). Without one recorded process, agents drift apart and
"done" means different things. Which process and which gates apply?

## Decision Drivers

- "Prove, don't claim": a milestone is done only when CI proves it.
- Small, reviewable changes from many contributors.
- A clean licence chain ([ADR-0004](0004-two-tier-licensing.md)).
- Readers must find docs by purpose.

## Considered Options

- Lightweight: conventions in CONTRIBUTING only, CI advisory
- Git-flow with long-lived release branches
- Trunk-based development with required gates and a reviewer before merge
  (chosen)

## Decision Outcome

Chosen option: "Trunk-based development with required gates and a
reviewer before merge", because it keeps branches short and makes every
quality rule a check instead of a hope.

- Commits: Conventional Commits, English, DCO sign-off (`git commit -s`)
  on every commit.
- Branching: trunk-based; short-lived branches, one topic per pull
  request; no long-lived release branches.
- Versioning: SemVer; `CHANGELOG.md` in Keep a Changelog format;
  `v0.1.0` only when M1 passes on Windows, macOS and Linux
  ([ADR-0020](0020-build-order-milestones.md)).
- Docs: Diátaxis (`docs/tutorials`, `docs/how-to`, `docs/reference`,
  `docs/explanation`), architecture as arc42 with C4 diagrams in Mermaid
  (`docs/architecture/`), decisions as ADRs
  ([ADR-0001](0001-record-architecture-decisions.md)), product docs in
  `docs/product/`, roadmap in `docs/roadmap.md`.
- Required CI checks on the trunk: lint, format, typecheck, unit tests
  with the coverage gate on `packages/core`, JSON Schema validation of
  valid and invalid examples, OpenAPI lint and contract tests, adapter
  conformance, build, dependency audit, SPDX/licence-tier check, DCO
  check, markdown lint and link check, secret scanning and the "no real
  data" check ([ADR-0022](0022-public-hygiene.md)); from M1 also
  Playwright e2e and an accessibility check (axe) on the board.
- Dependabot for npm and GitHub Actions updates.
- Branch protection on the trunk: pull requests only, required checks
  green, linear history not required (merges are `--no-ff`).
- Every pull request is reviewed by a second agent or model acting as
  reviewer before the maintainer merges; agents never merge their own
  work.
- `docs/verification.md` maps each acceptance criterion to a test file and
  a CI job; anything without a passing check is labelled "in progress".
- Pull request template with a Definition of Done: tests, docs, ADR if a
  decision, schema version bumped if changed, no real personal data.

### Consequences

- Good, because "done" is objective and visible in CI.
- Good, because parallel agents converge on the same conventions.
- Bad, because many required checks slow down the first pull requests.
- Bad, because the reviewer step adds latency to every change.

### Confirmation

Branch protection settings list the required checks; CI fails on a
missing DCO sign-off or a non-conventional commit title; reviewers check
the Definition of Done.

## Pros and Cons of the Options

### Conventions only

- Good, because no setup.
- Bad, because nothing enforces them.

### Git-flow

- Good, because familiar for release management.
- Bad, because long-lived branches and painful merges with many agents.

### Trunk-based with gates

- Good, because small changes and enforced quality.
- Bad, because CI must be fast and reliable.

## More Information

- Supersedes concept v1: `docs/05-roadmap.md` "fertig wenn" criteria based
  on owner walkthroughs; done now means proven in CI.
- Related: [ADR-0001](0001-record-architecture-decisions.md),
  [ADR-0004](0004-two-tier-licensing.md),
  [ADR-0020](0020-build-order-milestones.md),
  [ADR-0022](0022-public-hygiene.md).
