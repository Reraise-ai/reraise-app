# Contributing

Thanks for helping. This project is in M0 (foundations); please read the
[README](README.md) and [LICENSING.md](LICENSING.md) first.

## Workflow

- **Trunk-based development** with short-lived branches (`feat/...`, `fix/...`, `docs/...`).
  Keep pull requests small and reviewable.
- **Conventional Commits**: `feat(core): add card hashing`, `fix(api): ...`, `docs: ...`,
  `chore: ...`, `test: ...`, `ci: ...`. Breaking changes use `!` or a `BREAKING CHANGE:` footer.
- **DCO sign-off is required** on every commit: `git commit -s`
  (adds `Signed-off-by: Your Name <you@example.org>`). See <https://developercertificate.org/>.
- **SemVer** for releases; changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Setup

Requirements: Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm check:spdx && pnpm check:no-real-data
```

## Documentation

```sh
pnpm docs:dev          # live preview
pnpm docs:build        # build; dead links fail the build
pnpm check:doc-anchors # every #fragment link must point at an existing heading
```

## Dependency notes

- `pnpm.overrides` in the root `package.json` forces `vitepress>vite` to `^7.3.2`. VitePress 1.x
  bundles Vite 5, which has known advisories (one high severity, several moderate) that would
  fail the blocking `pnpm audit --audit-level high` job. Remove the override when VitePress
  ships a Vite release without them. Since 2026-10-29 it asks for `^7.3.7` (launch-editor
  advisory in Vite 7.0.0–7.3.6).
- Three more overrides (added 2026-10-29) lift transitive packages to their patched releases
  for the same audit job: `mermaid>dompurify` to `^3.4.17` (one critical and one high DOMPurify
  advisory), `jsdom>undici` to `^8.12.2` (four high undici advisories) and
  `express>body-parser` to `^2.4.0` (a high denial-of-service advisory; express comes in through
  `@modelcontextprotocol/sdk`). Remove each one once its parent package depends on a patched
  release itself.

## Definition of Done (every PR)

- [ ] Tests: automated tests cover the change; CI is green.
- [ ] Docs updated (reference, how-to or explanation as fitting).
- [ ] ADR added or updated if the PR makes or changes a decision.
- [ ] Schemas are versioned; any schema or canon change has an ADR.
- [ ] No real personal data, secrets or private infrastructure details. Synthetic data only.
- [ ] SPDX headers present and matching the directory's licence.
- [ ] UI uses design tokens only (no hard-coded colours or fonts).

## Claims must be proven

Feature claims in docs are backed by an automated test or a reproducible command.

## Conduct and security

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
