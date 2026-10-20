# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Embedding mode for the board: `?embed=1` (or the `embed` option of `<App>`) hides the demo notice; Sign out goes only when the host passes its own `client` and so owns the session, a board signed in with its own token keeps it. `?theme=light|dark` (option `theme`) takes the host's theme for every screen, the login form included; embedded without one, the board follows the system preference. A light theme in `src/tokens.css` keeps every text colour at WCAG AA (4.5:1) on both surfaces (`apps/board/src/tokens.test.ts`).

### Fixed

- `e2e/tests/time-slider.spec.ts` failed now and then on macOS: the state folder changed during the snapshot because the gate decision log (ADR-0030) appends a line for every card the screen reads, and a read still in flight landed after the snapshot. The test now leaves that log out of the file stamps and checks that it was only appended to.
- `worldbuilder serve` let any web page show the board in a frame, so a foreign page could pass it off as its own and steer the clicks or the typed token. `/` and `/assets/*` now send `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` (`services/api/src/main.test.ts`).
- The Hormuz example Lage placed its top row 200 px apart, but a card is 240 px wide, so the three cards overlapped. They now stand on the board's 280 px grid; `apps/board/src/exampleLayout.test.ts` checks every example Lage. The example proposal places its card at x 960, clear of the row.
- Embedded in a host (the Hermes desktop plugin), the cards could sit far down the canvas under a large empty band, and the board was taller than the host's box because the shell took the window height. The board now fills the host's box (or the window); the workbench row is bounded, so the canvas never grows with a long sidebar (and stays in view if a host gives no fixed height); the status line sits above the canvas instead of over it; and a fit aligns the cards to the top of the canvas, centred across. `e2e/tests/demo-build.spec.ts` checks less than 40 px empty above the cards beside a long sidebar in a fixed-height host box, and that the canvas ends inside the window.
- The board's heading, the login form and the page title show the product name Reraise instead of The Worldbuilder. Package names, code identifiers and the copyright line are unchanged.
- The canvas fitted the cards only once, at mount. When the window changed size afterwards (a host laying out its page, a restored window) the cards stayed off-centre with a large empty band above them. The canvas now fits again on a resize until the user pans or zooms (the + and − buttons count as the user's zoom).

## [0.2.0] - 2026-10-20

First tagged release. The asset `reraise-toolkit-0.2.0.zip` contains the entries below; the release workflow started the unpacked zip on a new store before attaching it.

### Changed

- M1 is done. CI job `e2e` runs the Hormuz walking skeleton (`e2e/tests/walking-skeleton.spec.ts`) on Linux, Windows and macOS. The green run is commit `4e0ebf8`.
- The gate rules `worldbuilder serve` writes on first start allow every card for the screen and for a local model on this device, including private cards. Nothing leaves the device and no transfer confirmation is required. Stance stays on the screen; no rule can release it. `cloud_model` and `demo` stay deny until you add an allow rule. A cloud transfer still needs the per-transfer confirmation (ADR-0031, owner 2026-10-13).

### Fixed

- The time slider showed a card as "Card not shown on this screen" when that card was on the earlier board but had left the board since, although its file still exists. The board now reads such a card, so the earlier board shows it with its current text. A card that no longer exists stays withheld (ADR-0049).
- The in-memory fake of the storage conformance kit refused an unsourced player entry on create but accepted it on `patch`. It refuses both now, as the markdown-files adapter does, and the kit tests an unsourced patch (ADR-0009, AC-28).
- The source profile no longer shows "Hit accuracy: 1 (n=5)". An outcome cannot record a miss yet, so the stored 1 is not a rate. The board shows "not yet measurable (n=5): outcomes cannot record a miss yet" (ADR-0018, OQ-31).
- The inspector reads the source profile again after the human enters an outcome. Before, it kept the count it had loaded (n=0) until another card was selected, although the service already held n=1 (ADR-0018, AC-11).
- Typecheck resolves `@worldbuilder/training-export` from its source, the same way as the other workspace packages. `dist/` is not in git, so CI no longer fails before that package is built.
- The store write lock treats Windows `EPERM` on an exclusive create as "someone else holds it" and waits, when the lock file is there.
- `model_ask` answers 200 again. The response schema no longer uses an `allOf` that Ajv strict mode cannot compile.

### Added

- `worldbuilder serve` serves the built board on its own origin (`/`, `/assets/*`, no credential, Host-checked), so the board needs no second server and no `--allow-origin`. `serve --init` creates a missing store with one empty, private world "My world". The start prints the session token and the URL to open on one line. `pnpm start` runs `worldbuilder serve` from a checkout. The built board's login form defaults to its own origin.
- A `v*` tag builds `reraise-toolkit-<version>.zip` (`.github/workflows/release.yml`, `scripts/pack-toolkit.mjs`): the built service with its production dependencies, the board, the examples and the licence files, in the repository layout, so `node services/api/dist/cli.js serve --init --store <folder>` runs with Node 22 and nothing to install. The workflow starts the unpacked zip on a new store before it attaches the zip to the release (`scripts/smoke-toolkit.mjs`). `Dockerfile` and `docker-compose.yml` run the same folder with store and state in the volume `/data`.
- The toolkit folder is the npm package `@reraise/app` with the command `reraise` and every dependency bundled, so `npm pack` in it gives a tarball that `npx ./reraise-app-<version>.tgz serve --init --store <folder>` starts without a registry. It is not published; the workspace packages stay private.
- `pnpm build:demo` writes a static board for `/board/`. It loads the Hormuz example from JSON and keeps edits in the browser. It does not call a Board API.
- The demo start world also loads the gold market and the vitamin D theme from `examples/gold` and `examples/vitamin-d`. The theme has the three questions from the public board demonstration, votes for and against, and one collector card.
- A theme Lage stores 2-4 questions, each with card ids arguing for and against, and exactly one collector card. The board lists the questions with vote counts. A click on a source opens the placed person or organisation card that names it (e-52, e-58, ADR-0051).
- The board exports opted-in decision traces as JSONL. `training_export` is human-only. The first call returns a cloud transfer preview and writes nothing; after `disclosure_confirm` the JSONL contains only cards with `training: true`. A card that did not opt in never appears, not even as an id. Stance data is never exported (ADR-0017).
- The board lists references from a connected HTTP/JSON source, an Obsidian vault and a document index. `finding_pin` reads the chosen URI again and stores a private card on the open Lage. The card copies the title and, when present, the short snippet. A second pin of the same URI returns that card and does not place it twice. The note text and a document body stay in the source. Both operations are human-only and are not MCP tools (ADR-0014). The document index is `GET` of `{ documents: [{ title, url, updated? }] }` until a named product is chosen (OQ-33). Paid news is not connected.
- Ollama, a cloud chat model and a decision-service stub answer through one `ModelConnector`. `model_ask` stores the answer as a pending comment by `agent:<engine>`. A cloud call returns the transfer preview and sends nothing until the human confirms that one transfer (ADR-0011, ADR-0015, ADR-0031).
- Two open boards on one service see a move within seconds. `GET /events` is human-only and sends a notice of kind `proposal` or `move`, with `lageId` when the change belongs to one Lage, and no card text. The board reads the change through the existing operations. A dropped stream falls back to `proposal_list`. Agents still poll (ADR-0032).
- The open board holds a what-if layer of assumptions that are not cards. Saving the layer writes nothing to the store. Recording a decision can attach that layer as a file in the state directory. The decision card stays unchanged (ADR-0050).
- The board can be shown as of an earlier date. `lage_versions` returns the archived Lage versions, oldest first. The current state is not included. The slider shows that board and does not save the view (ADR-0049).
- A test run in a browser on the Hormuz example proves the time slider on the real stack. Three changes in the board archive three states. `lage_versions` lists them oldest first with the time each was replaced and without the current one. The slider shows each earlier board and then the current one. Moving it sends no write request and leaves every file of the store and of the state directory as it was (ADR-0049).
- A player entry without a source is rejected. An empty player field is allowed. The board shows a source pass, "N findings · M origins", on each placed card, on an actor's seat entries and on its moves, on each edge, and on the cards a decision uses (AC-28, AC-30).
- A test run in a browser on the Hormuz example proves that rule on the real stack. A scripted agent's seat with an entry without a source is refused for `interests`, `capabilities`, `dependencies`, `moves`, `redLines` and `assumedGoals`, and nothing is stored. A seat with an empty field is accepted. The board shows the pass on the placed cards, on a seat and its moves, on a new edge between a copy and its original ("2 findings · 1 origin") and on a stored decision (AC-28, AC-30).
- The user creates a rule card and changes its action. The board form sends one card-on-board condition and the action in the user's words. The API accepts every condition kind. A condition that names a missing card is rejected. A restart of `worldbuilder serve` on the Hormuz store still evaluates the changed action. A field other than the title and the rule is left as stored (AC-10).
- A card with one known origin is marked "One source". The same statement from two origins that do not repeat each other is marked "Journalistic standard". A card that only cites another source does not count as a second source (Entscheidung 125).
- The open board lists each rule as fired or not fired, with that rule's own text and the cards that triggered it. It shows no percentage (AC-03).
- A card or a rule card that an agent only proposed does not fire a rule and is not listed in the rules panel until the human accepts it; a rejected proposal never does. A test now proves this on the service and in the browser (ADR-0011, AC-03).
- The open board records a decision (eleven sections, cards on the board) and its outcome. A known outcome shows the experience card the service stored.
- The board's decision panel has a protocol: it lists the decisions already in the store, newest first. Opening one shows its eleven sections. While the outcome is `open` the panel takes the outcome, also after a reload or a restart, and a known outcome stores one linked experience card (AC-12). No contract changed. `decision_save` is tested to refuse an unknown `cardsUsed` id and leave the card unchanged.
- Recording a known outcome stores one private experience card. Its edges are `based_on` the decision and each id in `cardsUsed`. An outcome of `open` stores none. A later change of the outcome text does not store a second card. A restart of `worldbuilder serve` on the Hormuz store still has the decision's eleven sections and that experience card. An unknown `cardsUsed` id is rejected (AC-09, AC-11, AC-13).
- A known decision outcome adds one to the stored hit count of each source cited by `cardsUsed`. The previous profile stays on the device. The board shows the eight dimensions with their sample size and says "insufficient data" when `n` is below 5. There is no combined figure (ADR-0018, AC-11). Until an outcome can record a miss, `hitAccuracy` is 1 per sample and the board does not present that as a correctness rate (OQ-31).
- A context package for any target other than the screen leaves out a rule card that states a stance, or that names a card outside the package. The rule is counted and not rewritten. On the Hormuz store a `local_model` package under the shipped default still contains the reroute rule, which names only the wire report, and does not contain the stance rule (AC-18).
- A context package for any target other than the screen keeps a relation only when both cards are in that package. An edge, a Lage placement, or a decision `cardsUsed` id that names another card is dropped. The rendered body of a changed Lage or decision is dropped with it, and `contentHash` is the hash of the view. On the Hormuz store a `local_model` package under the shipped default has the navy `represents` edge to the wire report, and the decision's `cardsUsed` list keeps the wire report, the navy and the insurance card, because the local model may see them. The screen package is unchanged. A confirmed cloud transfer still sends the stored cards (AC-18).
- A deterministic local model, `local-quote`, answers a context package by naming the card ids it was given. It writes no proposals and uses no network. On the Hormuz store the private cost card stays in the file store. The shipped default puts it in a `local_model` context package, and `local-quote` names its id. A `cloud_model` package with no confirmation does not contain it (AC-16).
- The user can draw, reverse and delete `supports` and `refutes` edges. A restart of
  `worldbuilder serve` on the Hormuz store keeps the reversed `supports` edge, and a deleted
  `refutes` edge stays gone (AC-08).
- The user can create a Lage with their own question and any number of options, including none.
  A repeated option line is stored once. The open board shows the question and each option.
  A restart of `worldbuilder serve` on the Hormuz store still has that Lage (AC-07).
- A restart of `worldbuilder serve` on the Hormuz store keeps a drawn `supports` edge and a
  private stance. The stance is a file under the state directory (`stances/<cardId>.json`) and
  is not written into the card store. A page reload already showed the same board (AC-05).
- The board can take one placed card off a Lage ("Remove from board"). The card file stays in
  the store. Edges that used the card leave with it. The next context package is built from
  the cards still on the Lage, so the removed card is not in it (AC-22).
- Origin roots are counted in `@worldbuilder/core` (`originRoots`, `independenceOf`). A `cites`
  or `based_on` chain, the same `contentHash`, or the same source URI is one root. A root with
  no source is unknown and keeps its own id. The count is derived at read time and never stored
  (ADR-0009, AC-29). The Board API context package uses this count.
- The board shows which system a card came from (`originSystem`) on the canvas, in the card
  list and in the inspector. A card with no origin system shows no system line (AC-06).
- The board shows each card's stored content type (`card.type`) on the canvas, in the card
  list and in the inspector. A premise stays an `assumption` and an own assessment stays a
  `rating`. The type is not rewritten as a layer (AC-04).
- The context package on the board lists findings and origins per layer (`evidenced`, `said`,
  `experience`, and `unclassified` only when a card has no layer). A layer with nothing in it
  stays on the list as zero. There is no summed card total. The cloud preview uses the same
  split for "this would be sent" and "withheld by the gate". A stance is not a layer and does
  not change the figures (AC-01).
- Quiet attribution "Powered by Private Executive" on the board (the login screen and the working
  screens), in the README, and in the documentation footer. "Private Executive" is a link that
  opens in a new tab. The address is the constant `PRIVATE_EXECUTIVE_URL` in
  `apps/board/src/privateExecutive.ts`. The docs site imports that constant. The README link uses
  the same address.
- Optional descriptive card fields (ADR-0048): `language` (BCP 47), `validFrom` and `validUntil`,
  `aliases`, and `refs`. The format stays v2. None of them changes `contentHash`. When the
  disclosure gate allows a card for the owner's own cloud agent, the card goes as it is,
  including `refs`; the lock is the gate. A share carries public information whatever field it
  is in: `language`, the validity period and `aliases` travel, and a `refs` entry is kept only
  when its `url` is a public address under the same rule as `source`. `validUntil` must not be
  earlier than `validFrom`. The legacy format has no names for these fields.
- End-to-end test of the M1 walking skeleton (`e2e/`, Playwright with Chromium, `pnpm test:e2e`):
  the built service and board on loopback ports over a temporary copy of the synthetic Hormuz
  store, a scripted MCP agent that consults the knowledge and proposes a card, the human accepting
  it, persistence after a reload, a context package, the disclosure gate withholding the private
  card from a cloud target, and the files on disk (Lage version archived). axe-core runs on the
  main board screens. CI job `e2e` on Linux, Windows and macOS was green at commit `4e0ebf8`.
- Level-1 engines (ADR-0035) in the new package `@worldbuilder/level1-engines`: the deterministic
  local rules engine (`createLocalRulesEngine`, with a per-option basis), the what-if re-run and
  stale-prediction helpers, the level-2 escalation draft, the cloud System One HTTP adapter
  template with a Jev preset (release-only, injected `fetch`; the real Jev wire format is
  unconfirmed) and `formatEstimate` for the board. Service wiring and the board panel follow.
- MCP server on the official SDK: the thirteen agent tools with self-contained schemas, served at
  `/mcp` of the service over Streamable HTTP (agent bearer token, Host and Origin checks, per-agent
  sessions, `cloud_model` confirmation flow) and through the stateless stdio bridge
  `worldbuilder mcp --stdio`; every tool runs the operation code of its HTTP route.
- Knowledge loop (ADR-0039 to ADR-0043): Knowledge and Write-back Receipts, the hash-chained
  receipt log and its fail-closed verifier, usage metrics per agent and week with the owner's
  targets, deterministic memory routing and atlas pages with card links and staleness, in the
  new package `@worldbuilder/knowledge-loop` with the offline `wb` command line
  (`wb receipts verify`, `wb digest`, `wb metrics`); MCP tools `knowledge_consult`,
  `knowledge_write_back`, `decision_record`, `decision_outcome`, `memory_route` with Board API
  mirrors, the proposal kind `record_outcome`, and the opt-in training export builder.
- Reference `markdown-files` storage adapter: byte-preserving patches, archive and versions,
  derived in-memory index with file watcher and rescan fallback, single-writer lock file, search
  by text, type, layer, world and tags; passes the StorageAdapter conformance kit.
- Repository foundation: community files, licensing (Apache-2.0 / AGPL-3.0-or-later),
  issue and pull request templates, Dependabot configuration.
- pnpm workspace tooling (TypeScript strict, ESLint, Prettier, Vitest), package skeletons, SPDX and
  no-real-data checks, schema validation script, CI and CodeQL workflows.
- Architecture documentation (arc42) with C4 context and container diagrams, runtime scenarios,
  quality scenarios, risks and technical debt, and open decisions.
- ADR-0029 to ADR-0033: process topology, local state, gate rules and confirmation binding, M1
  proposal polling, and the derived index of the reference adapter.

### Changed

- Markdown-files reads `aliases` leniently: a single non-empty string becomes a one-item list and
  an empty list is treated as absent. Writes always emit the list form. `language`, `validFrom`,
  `validUntil` and `refs` stay strict, so a file that already carried one of them with a
  non-conforming value is now reported as an invalid card.

### Fixed

- Origin roots no longer depend on card order. A quote of a cite cycle keeps that cycle's root, and two cycles one card cites stay two origins. The quote keeps the smaller root (ADR-0009).
- Board: the open board has one main landmark and no skipped heading level (found by axe).
- Board: the canvas fills the board area (it had collapsed to a thin strip, so cards were clipped).
- Board: the stance weight slider sends an integer from 1 to 3 as the contract requires (it sent
  0.5 and the service refused it with a 400).
