# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
  main board screens. CI job `e2e` on Linux, Windows and macOS (not run yet).
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
