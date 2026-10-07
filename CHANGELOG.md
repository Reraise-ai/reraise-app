# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Level-1 engines (ADR-0035) in the new package `@worldbuilder/level1-engines`: the deterministic
  local rules engine (`createLocalRulesEngine`, with a per-option basis), the what-if re-run and
  stale-prediction helpers, the level-2 escalation draft, the cloud System One HTTP adapter
  template with a Jev preset (release-only, injected `fetch`; the real Jev wire format is
  unconfirmed) and `formatEstimate` for the board. Service wiring and the board panel follow.
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
