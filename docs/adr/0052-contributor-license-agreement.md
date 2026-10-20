---
status: proposed
date: 2026-10-18
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0052: Contributor License Agreement for the AGPL paths (Harmony with promise-back); DCO stays for every commit

## Context and Problem Statement

[ADR-0004](0004-two-tier-licensing.md) split the repository into Apache-2.0 parts and
AGPL-3.0-or-later parts and required only a Developer Certificate of Origin (DCO) sign-off:
"there is no CLA". Under DCO plus AGPL, every contributor licenses their work to the project
and to everyone else under the AGPL, and nothing more. The project's legal entity, Caprey SAS,
could then offer the AGPL parts (`apps/board`, `services/api`, `packages/mcp-server`, `e2e`)
only under the AGPL, because it holds no right to license outside contributions under other
terms.

On 2026-10-18 the owner decided to keep the option of selling paid licences of the AGPL parts
that carry no AGPL duties (OQ-37). The free parts stay free: everything open can still be
downloaded, used, modified and shared under the AGPL, forever. Paid offers add convenience;
they never take away anything that is open. The hosted platform stays a separate, closed
service ([ADR-0021](0021-privacy-and-sharing-model.md)). How do we get the right to
license outside contributions under other terms without breaking the contributors' trust?

The decision must be taken before the first outside contribution is merged. Afterwards,
every contributor would have to be asked again, and some could not be reached. At the time of
writing the repository holds no outside contribution.

## Decision Drivers

- The option to license the AGPL parts commercially, without AGPL duties, must exist before the
  first outside contribution (owner decision, OQ-37).
- Contributors need a binding promise, not a statement of intent: their contribution stays
  publicly available under a free licence.
- Little friction: signing takes one sentence in a pull request, with free tooling, without
  paper or e-mail.
- Nobody gets extra rights over the Apache-2.0 parts; they need none.
- A clean, checkable licence chain per contribution ([ADR-0004](0004-two-tier-licensing.md)).
- The legal entity is Caprey SAS, an Argentine company; Argentine law applies (owner
  decision 2026-10-18).
- Public hygiene ([ADR-0022](0022-public-hygiene.md)) must still hold.

## Considered Options

- DCO only (status quo of ADR-0004)
- Apache-ICLA-style licence grant with free relicensing and no promise back
- Harmony licence agreement with outbound licence "Option Five" (any licence, with a promise
  back) and a binding commitment section (chosen)
- Harmony licence agreement with outbound licence "Option Three" (original licence plus
  OSI-approved licences only)
- Copyright assignment (Harmony assignment agreement, FSF style)

## Decision Outcome

Chosen option: "Harmony licence agreement with Option Five and a binding commitment section",
because it is the only option that both lets Caprey SAS license contributions to the AGPL parts
under any terms (including proprietary) and gives contributors an enforceable promise that
their contribution always stays available under AGPL-3.0-or-later.

Rules:

1. **Scope.** The CLA covers contributions to the AGPL paths named in
   `LICENSING.md`: `apps/board`, `services/api`, `packages/mcp-server`,
   `e2e`. Contributions to the Apache-2.0 paths stay under Apache-2.0 with DCO only. A pull
   request that touches both needs both.
2. **Texts.** Two agreements, in English, derived from the Harmony 1.0 licence templates (CC BY
   3.0): `legal/cla/CLA-INDIVIDUAL.md` and
   `legal/cla/CLA-ENTITY.md`. The contributor keeps the copyright
   (licence, not assignment). The licensor is Caprey SAS. Governing law is Argentine law;
   jurisdiction is the ordinary courts of the City of Buenos Aires.
3. **Outbound licence = Harmony "Option Five".** Caprey SAS may license the contribution under
   any licence, including copyleft, permissive, commercial or proprietary, on the condition
   that the contribution also stays available under the licence the project uses on the
   submission date. Option Five already makes the grant conditional on that promise. The texts
   spell the promise out as a separate Section 3, "Our commitment to you": the contribution stays public with its
   history under AGPL-3.0-or-later; whenever it is offered under another licence it is offered
   under the AGPL at the same time, free of charge and with source; the AGPL is never
   withdrawn, restricted or replaced (other licences may be added); contributors stay credited;
   `LICENSING.md` says openly that other terms exist; if the promise is broken, the grant
   beyond the AGPL ends for new licences; successors must accept the promise in writing.
   Option Three (OSI-approved licences only) was rejected because it does not allow proprietary
   licences, which is the purpose of this ADR.
4. **Acceptance.** An individual accepts by posting a fixed sentence as a pull request comment.
   An organisation signs once through a pull request that adds an entity record
   `legal/cla/entities/<organisation>.json`; a maintainer verifies the signatory's authority
   and merges it. The CLA applies to contributions made before signing as well, so the owner
   signs the Individual CLA once for the existing history.
5. **Enforcement tool.** A project-owned check, not a third-party GitHub Action: the workflow
   `.github/workflows/cla.yml` runs `scripts/cla-check.mjs` from the default branch on
   `pull_request_target` and `issue_comment`, lists the files of the pull request through the
   GitHub API, requires a signature when a file lies in an AGPL path (a rename from an AGPL
   path counts), and reports the commit status `CLA`. Signatures live as a JSON file on the
   branch `cla-signatures` (public). A second workflow, `.github/workflows/dco.yml`, runs
   `scripts/dco-check.mjs` as the job `DCO` and checks the `Signed-off-by` line on every
   commit of a pull request. That closes the DCO half of ADR-C08 that
   [ADR-0004](0004-two-tier-licensing.md) and [ADR-0025](0025-engineering-process-and-quality-gates.md)
   promised and nobody wrote. Reason for not using `contributor-assistant/github-action`: the
   repository was archived on 2026-03-23, it declares the `node20` runtime that GitHub removed
   from its runners on 2026-09-23, it has no path filter, and it needs write permissions in a
   `pull_request_target` workflow. A project-owned script of about 220 lines has none of these
   problems and is unit-tested like the other scripts.
6. **Founders, bots and agents.** Dependabot and `github-actions[bot]` are exempt. Commit
   authors without a GitHub account (for example agent identities) count as the responsibility
   of the pull request author, who must have signed.

### Consequences

- Good, because paid licences of the AGPL parts without AGPL duties become legally possible,
  for every future contribution.
- Good, because contributors get a binding promise with a remedy (the extra permission ends),
  which is what communities usually ask for instead of "trust us".
- Good, because the Apache-2.0 parts, which are the contribution surface for adapters and
  libraries, carry no CLA and no friction.
- Good, because signing is one sentence and the record is public and checkable.
- Bad, because a CLA is friction and some developers refuse on principle; they can still
  contribute to the Apache-2.0 parts, and the AGPL parts stay forkable under the AGPL.
- Bad, because the licensing chain needs administration: texts, signature record, entity
  records, versions.
- Bad, because Caprey SAS (a legal entity) and contributors' GitHub identities are now named in
  the public repository; this is a deliberate narrow exception to the spirit of
  [ADR-0022](0022-public-hygiene.md), which keeps the owner's personal names and
  infrastructure out. The signature branch is outside `main`, so `check:no-real-data` does not
  scan it.
- Bad, because the choice of Argentine law and the Buenos Aires forum may deter contributors
  abroad, and the electronic acceptance by comment rests on Argentine rules for electronic
  declarations that have not been reviewed by Argentine counsel (see Open points).
- Bad, because agent-written code in the existing history may not carry a human copyright; the
  owner's signature covers only what he owns or asserts (CLA Section 6).
- Neutral: the owner's own contributions are covered by his signature like everyone else's;
  there is no exemption.

### Confirmation

- Required status checks on `main`: `CLA` and `DCO`. A pull request that changes a file under
  `apps/board`, `services/api`, `packages/mcp-server` or `e2e` (or renames a file out of one)
  without a signature of its author and of each linked commit author does not merge.
- `scripts/cla-check.test.mjs` (Vitest): table-driven tests for the path rule, renames, a
  docs-only pull request, an unsigned author, a signed author, an entity member, a bot, an
  agent identity without account, more than 3000 changed files (fails closed) and an API
  error (fails closed, never green).
- The list of CLA paths is imported from `AGPL_DIRS` in `scripts/check-spdx.mjs`; a test fails
  if the two ever differ, so `LICENSING.md`, `REUSE.toml`, the SPDX check and the CLA check
  stay one list.
- One run on the real repository with a second GitHub account: a pull request into
  `apps/board` is red; after the signature comment it is green; a pull request that changes
  only `docs/` is green without a signature. The run links are recorded in the pull request
  that enables the check.
- [verification.md](../verification.md): new row ADR-C58 (CLA) and the update of ADR-C08 (DCO).
- Review checklist: the pull request template asks for the CLA signature when an AGPL path is
  touched.

## Pros and Cons of the Options

### DCO only (status quo of ADR-0004)

- Good, because no friction and no extra legal text.
- Good, because the project has no administration of signatures.
- Bad, because the AGPL parts can then be licensed only under the AGPL. Paid licences without
  AGPL duties would need the consent of every contributor, and that gets less feasible with each
  merged contribution.

### Apache-ICLA-style licence grant, free relicensing, no promise back

- Good, because well known (Apache ICLA/CCLA) and flexible for the licensor.
- Bad, because the contributor has no assurance that the code stays free; the licensor could
  later close the project. Communities reject this form most often.

### Harmony licence agreement, Option Five with commitment section (chosen)

- Good, because the licensor may use any licence, and the contributor has a conditional grant:
  break the promise and the extra permission ends.
- Good, because the contributor keeps the copyright, so there is nothing to register or assign
  (Argentine law treats assignments of copyright and moral rights with more formalities than a
  licence).
- Good, because Harmony is a published template with known reading and a plain-language
  structure.
- Bad, because the promise protects the contribution, not the whole product; the licensor may
  combine open code with closed additions of its own.
- Bad, because Option Five of the template alone is short; the commitment section is our own
  text and has not been tested in court.

### Harmony licence agreement, Option Three (original licence plus OSI-approved licences only)

- Good, because the strongest assurance to contributors that the code never goes closed.
- Bad, because it forbids proprietary and commercial licences, which are the point of this
  decision.

### Copyright assignment

- Good, because the licensor holds all rights and can relicense without limits, and enforces
  alone.
- Bad, because contributors lose their copyright; it is the least accepted form.
- Bad, because assignments and moral rights under Argentine law carry formal requirements that a
  licence avoids. Not checked in detail.

## More Information

- Amends [ADR-0004](0004-two-tier-licensing.md), in one point only: the bullet "Contributions
  require a Developer Certificate of Origin sign-off (`git commit -s`); there is no CLA". The
  two-tier split, the SPDX/REUSE rules and the import rule stay. How ADR-0004 is marked:
  its status stays `accepted` and a block is added under its title, as the repository already
  does for ADR-0021, -0028, -0031, -0034 and -0036 (the status list of
  [ADR-0001](0001-record-architecture-decisions.md) has no "amended" value; marking ADR-0004
  `superseded` would wrongly retire the whole licensing decision):

  ```markdown
  > Amended by [ADR-0052](0052-contributor-license-agreement.md): contributions to the
  > AGPL-3.0-or-later paths also need a signed Contributor License Agreement (Harmony with a
  > promise-back). "There is no CLA" no longer applies there. The DCO sign-off stays for every
  > commit, and the Apache-2.0 paths stay DCO only.
  ```

- Supersedes concept v1: nothing.
- Related: [ADR-0004](0004-two-tier-licensing.md), [ADR-0021](0021-privacy-and-sharing-model.md),
  [ADR-0022](0022-public-hygiene.md), [ADR-0025](0025-engineering-process-and-quality-gates.md),
  [owner-questions.md](../owner-questions.md) OQ-37.
- Sources:
  [Harmony agreements](https://www.harmonyagreements.org/agreements) and the
  [combined template v1.0](https://www.harmonyagreements.org/docs/ha-combined-v1) (Section 2.3,
  Option One to Five); [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/);
  [contributor-assistant/github-action](https://github.com/contributor-assistant/github-action)
  (archived 2026-03-23);
  [GitHub: Node 20 deprecation on runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)
  (Node 24 default from 2026-06-16, Node 20 removed 2026-09-23);
  [GitHub: events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
  (`pull_request_target`, `issue_comment`).
- Open points before `status: accepted`: (1) review of the two texts by Argentine counsel,
  especially electronic acceptance by comment, the moral-rights wording and the forum clause;
  (2) the owner confirms that the sentence "also offered under other terms" may go public in
  `LICENSING.md` (CLA Section 3.4 requires it); (3) the owner signs the Individual CLA; (4)
  branch protection on `main` requires the statuses `CLA` and `DCO`.
