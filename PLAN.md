# Plan: M2 slice "Decision card, protocol and outcome"

Branch `slice/m2-decision-card`. Working note for this slice; delete it once the slice is merged.

## What is already there (read, not assumed)

Checked against the code and the tests on `main` (`89dba98`):

| Part of the done criterion                              | Already built                                                               | Proof today                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| stores all 11 sections                                  | `decision.schema.json`, `decision_create`/`decision_save`, markdown adapter | `services/api/src/contract.test.ts`, `hormuz.test.ts`        |
| reloads intact                                          | files are the truth ([ADR-0006](docs/adr/0006-files-are-the-truth.md))      | `hormuz.test.ts` (new `serve` process reads all 11 sections) |
| rejects a `cardsUsed` id that does not exist            | `requireCards` on create and save                                           | `contract.test.ts`, `hormuz.test.ts` (create only)           |
| entering the outcome creates one linked experience card | `outcome-experience.ts`                                                     | `contract.test.ts`, `hormuz.test.ts`, `knowledge.test.ts`    |
| board records the decision and its outcome              | `apps/board/src/components/DecisionPanel.tsx`                               | `App.test.tsx` ("decision")                                  |

## The gap

1. AC-12 "a decision protocol exists across sessions, not only for the current one" is "not started"
   in `docs/verification.md`. `DecisionPanel` carries a `shortcut:` comment that says the same: it
   shows only the decision recorded in this visit. After a reload the user cannot see a stored
   decision or enter its outcome later, which is the normal case (the outcome is known weeks later).
2. The reject-unknown-`cardsUsed` check is proven for create only, not for `decision_save`, and the
   "outcome entered in a later session" path has no test on the real service.
3. No test drives the decision flow through the real board and service together.

## Design (smallest change)

No contract change. `cards_search` with `type=decision` already exists on the OpenAPI contract and
the human (screen) caller gets decisions through the gate.

- `DecisionPanel` gets a **Protocol** list: on mount it calls `cards_search({ type: 'decision' })`
  and lists title and outcome (`open` or the text). The list refreshes after a create or a save.
- Choosing an entry opens it: the eleven sections are shown read-only (reload intact is visible),
  the outcome form is shown while the outcome is `open`, and the linked experience card is shown
  when the outcome is known. A "New decision" button returns to the create form.
- Errors from the list call go to the existing `decision-error` line. No new colour, font, library.
- No new dependency. Reuses `isKnownOutcome`, `describeError`, the existing tokens and classes.

## Files

- `apps/board/src/components/DecisionPanel.tsx` (protocol list, open, new)
- `apps/board/src/DecisionProtocol.test.tsx` (new: unit/component test against the mock API)
- `services/api/src/hormuz.test.ts` (new test: three sessions on the Hormuz store)
- `services/api/src/contract.test.ts` (`decision_save` rejects an unknown `cardsUsed`)
- Docs: `docs/verification.md` (AC-12, AC-09, AC-11, AC-13 rows), `docs/roadmap.md`,
  `docs/architecture/05-building-blocks.md`, `CHANGELOG.md`

## Test strategy

- Service, real files, three `worldbuilder serve` processes on the Hormuz copy: session 1 saves a
  decision with outcome `open` and a rejected one with an unknown id; session 2 lists decisions
  (`GET /cards?type=decision`), finds it, enters the outcome, one experience card appears;
  session 3 reads all 11 sections and the one linked card. A save with an unknown `cardsUsed` is 400.
- Board component test (mock API): an earlier decision is listed on mount, opening it shows the
  eleven sections, entering the outcome shows the experience card, the list shows the new outcome.
- Playwright e2e only if Chromium can be installed on this host (otherwise reported as a gap).
- Gates: `pnpm lint`, `typecheck`, `test`; `check:generated`, `validate:schemas`, `lint:openapi`
  are unaffected (no contract touched) but are run.
