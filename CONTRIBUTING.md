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
  Changes to the AGPL-3.0-or-later directories also need a signed Contributor License
  Agreement; see [Licence terms for contributions](#licence-terms-for-contributions).
- **SemVer** for releases; changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Licence terms for contributions

What you have to do depends on where your pull request lands. The directory table is in
[LICENSING.md](LICENSING.md).

| Where your change lands                                                             | Your work is licensed under                                             | You do                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| Apache-2.0 parts: everything except the four directories below                      | Apache-2.0                                                              | Sign off every commit (`git commit -s`).         |
| AGPL-3.0-or-later parts: `apps/board`, `services/api`, `packages/mcp-server`, `e2e` | AGPL-3.0-or-later, and you grant Caprey SAS the extra rights in the CLA | Sign off every commit **and** sign the CLA once. |

A pull request that touches both kinds of parts needs both.

### Signing the CLA

The check named `CLA` runs on every pull request. If the pull request touches an AGPL part and
you have not signed, it fails and the bot asks you to sign.

- **Individuals.** Read the [Individual CLA](legal/cla/CLA-INDIVIDUAL.md). Then post this
  sentence, unchanged, as a comment on the pull request:

  ```text
  I have read the Reraise Individual CLA v1.0 and I agree to it.
  ```

  The check turns green within a minute. You sign once; it holds for all your later pull
  requests as long as the CLA stays at version 1.0. Your GitHub username, numeric account ID,
  the time and the link to your comment are stored in a public record (branch
  `cla-signatures`).

- **Companies and other organisations.** If your employer owns what you write, your employer
  signs the [Entity CLA](legal/cla/CLA-ENTITY.md) instead. An authorised signatory opens a pull
  request that adds `legal/cla/entities/<organisation>.json` (organisation name, signatory
  name and title, date, CLA version, and the GitHub usernames of the people who may
  contribute). A maintainer confirms the signatory's authority and merges it. From then on the
  listed people do not sign individually.
- **Bots.** `dependabot[bot]` and `github-actions[bot]` need no signature.

### What the CLA does and does not do

- You keep the copyright in your work.
- Caprey SAS may license your contribution to the AGPL parts under other terms as well,
  including paid licences that do not require publishing source code.
- In return, Caprey SAS commits (Section 3 of the CLA, "Our commitment to you") that your
  contribution stays public and free under AGPL-3.0-or-later, is never withdrawn or replaced,
  and that you stay credited. If that commitment is broken, the extra permission ends.
- The Apache-2.0 parts are not covered by the CLA. Nobody gets extra rights over them.

### Third-party code and AI tools

Do not include code written by others unless its licence is permissive (for example MIT,
BSD, Apache-2.0); name the author and the licence in the pull request description and keep the
original notices. If you used AI tools, you have reviewed the result and you are entitled to
submit it (CLA Section 6).

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
  ships a Vite release without them.

## Definition of Done (every PR)

- [ ] Tests: automated tests cover the change; CI is green.
- [ ] Docs updated (reference, how-to or explanation as fitting).
- [ ] ADR added or updated if the PR makes or changes a decision.
- [ ] Schemas are versioned; any schema or canon change has an ADR.
- [ ] No real personal data, secrets or private infrastructure details. Synthetic data only.
- [ ] SPDX headers present and matching the directory's licence.
- [ ] CLA signed if the change touches `apps/board`, `services/api`, `packages/mcp-server` or `e2e` (the `CLA` check is green).
- [ ] UI uses design tokens only (no hard-coded colours or fonts).

## Claims must be proven

Feature claims in docs are backed by an automated test or a reproducible command.

## Conduct and security

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
