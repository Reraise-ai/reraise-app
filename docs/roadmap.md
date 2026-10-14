# Roadmap

The build order ([ADR-0020](./adr/0020-build-order-milestones.md)) is **contract-first, then a walking skeleton, then vertical slices**. Neither
"UX first" nor "architecture first": the UX concept exists as design material, so the next
step is to fix the contracts, then prove the thinnest real path end to end, then add one
slice per pull request.

::: info Status in one line
**M1 is done.** The Hormuz walking skeleton is the Playwright test in
`e2e/tests/walking-skeleton.spec.ts`. CI job `e2e` runs it on Linux, Windows and macOS.
That job was green at commit `4e0ebf8`. M0 stays in progress. The next work is the M2 slices.
No feature is claimed unless an automated test backs it. The table of record is
[verification](./verification.md).
:::

GitHub milestones and one issue per slice will be created once repository access works.
Until then this page is the plan of record.

## Milestones at a glance

| Milestone | Goal | Status | Done when |
| --- | --- | --- | --- |
| **M0** Repository foundation and contracts | Monorepo, tooling, CI, docs, ADRs, contracts as code. No features. | in progress | CI is green, schemas validate the examples, the ADR log is complete, the docs build |
| **M1** Walking skeleton | Thinnest end-to-end path, everything real, nothing pretty | done at `4e0ebf8` (job `e2e` green on Linux, Windows and macOS) | one Playwright end-to-end test runs the scenario below in CI |
| **M2+** Vertical slices | One pull request per slice: UI, API, adapter and tests together | in progress | per slice, see [below](#m2-vertical-slices) |

## M0: repository foundation and contracts

Status: in progress.

Scope:

1. Monorepo, tooling, CI and docs skeleton: TypeScript strict, pnpm workspaces, Node 22,
   ESLint, Prettier, Vitest, licensing, community files.
2. An ADR for every binding decision (MADR format).
3. Contracts as code, versioned: JSON Schema for Card, World, Lage, Edge, Stance, Decision,
   SourceProfile and ContextPackage; OpenAPI 3.1 for the Board API; MCP tool definitions;
   the adapter interfaces `StorageAdapter`, `SourceConnector`, `ModelConnector` and
   `DisclosureGate`.
4. Architecture documentation: arc42 and C4 diagrams.
5. Example synthetic worlds (`hormuz`, `palma`, `gold`, `vitamin-d`) that the schemas validate.

**Done when:** CI is green, the schemas validate the examples, the ADR log is complete and
the docs build.

## M1: walking skeleton

Status: done at commit `4e0ebf8`. CI job `e2e` runs this scenario on Linux, Windows and macOS, and that run was green. A restart of `worldbuilder serve` on the Hormuz store keeps a drawn edge and a private stance (AC-05). The same restart keeps a Lage the user created, with their question and any number of options, including none (AC-07). A restart keeps a reversed `supports` edge, and a deleted `refutes` edge stays gone (AC-08). `local-quote` answers a Hormuz context package with the ids the gate cleared. Under the shipped default it names the private cost card; a `cloud_model` package with no confirmation does not contain that card (AC-16). A `local_model` package of that store keeps a relation only when both cards are in the package, so the decision's `cardsUsed` list keeps the wire report, the navy and the insurance card. A rule that states a stance, or that names a card outside the package, is left out. The Hormuz stance rule is absent. The reroute rule, which names only the wire report, stays (AC-18). The page reload of the walking skeleton is the end-to-end test.

The board context package lists findings and origins per layer (AC-01). A card shows its stored origin system on the canvas, in the card list and in the inspector (AC-06). Removing a placed card takes it off the Lage and out of the next context package. The card file stays in the store (AC-22). The checks are in
[verification](./verification.md).

Components: Board UI, Board API, the reference `markdown-files` storage adapter (same file
conventions as the [card format](./reference/card-format.md), synthetic data), and an MCP
server.

Scenario, using the Hormuz example:

1. Open a Lage.
2. Place an existing card.
3. Draw a `supports` edge.
4. A test agent proposes a card through MCP.
5. A human accepts the proposal.
6. Reload: the state persisted.
7. A context package is generated.
8. The disclosure gate blocks a private card for the cloud target.

**Done when:** one Playwright end-to-end test runs this scenario in CI. That criterion is met
at commit `4e0ebf8` (job `e2e` green on Linux, Windows and macOS). The v0.1.0 tag is not cut.

## M2+: vertical slices

Each slice is one pull request with UI, API, adapter and tests. The order may change; the
done criterion is what counts.

The decision slice stores the eleven sections, rejects an unknown `cardsUsed` id, and the
board records the decision and its outcome. A known outcome stores one linked experience
card.

The source-profile slice meets its done criterion: a known outcome adds one to the stored
hit count of each source cited by `cardsUsed`, the previous profile stays on the device,
and the board shows every dimension with its sample size and "insufficient data" below
`n` of 5.

The rules panel lists each rule as fired or not fired, with the rule's own text and the
triggering cards, and shows no percentage. The user creates a rule card and changes its
action. The next evaluation reads that stored card (AC-10). The board form sends one
card-on-board condition. The API accepts every condition kind.

A card with one known origin is marked on the board. The same statement from two origins
that do not repeat each other is marked as meeting the journalistic standard (Entscheidung 125).

A player entry without a source is rejected. An empty player field is allowed. The board
shows a source pass, "N findings · M origins", on each placed card, on an actor's seat
entries and on its moves, on each edge, and on the cards a decision uses (AC-28, AC-30).

The board can be shown as of an earlier date. `lage_versions` returns archived Lage
versions, oldest first, and the current state is not included. The slider shows that
board and does not save the view (ADR-0049).

The open board holds a what-if layer of assumptions that are not cards. Saving the layer
writes nothing to the store. Recording a decision can attach that layer. The attachment
is a file in the state directory. The decision card is unchanged (ADR-0050).

Two open boards on one service see a move within seconds. `GET /events` sends a notice
with no card text. The board reads the change through the existing operations. A dropped
stream falls back to `proposal_list`. Agents still poll (ADR-0032).

Ollama, a cloud chat model and a decision-service stub answer through one `ModelConnector`.
The answer is a pending comment, not a card. A cloud call shows the envelope and sends
nothing until that transfer is confirmed (ADR-0011, ADR-0015, ADR-0031).

An HTTP/JSON list, an Obsidian vault and a document index report references. Pinning one
stores a private card on the open Lage and does not copy the source text. A second pin
returns the same card. Paid news stays later (ADR-0014, OQ-33).

The training export writes a JSONL file of decision traces. A trace is exported only if
the decision has `training: true` and a known outcome. Cards that did not opt in never
appear, not even as ids. The first call shows the envelope; nothing leaves until that
transfer is confirmed (ADR-0017).

| Slice | Done when |
| --- | --- |
| Decision card, protocol and outcome | A decision stores all 11 sections, reloads intact, rejects a `cardsUsed` id that does not exist, and entering the outcome creates a linked experience card. |
| Rules panel replacing the barometer | Rules come from rule cards, never from code. Evaluation lists each rule as fired or not fired with the ids of triggering cards and shows no percentage. A proposed (unaccepted) card never fires a rule. |
| Source profile and hit statistics from outcomes | Entering an outcome changes the stored hit count of the affected source, the earlier state stays retrievable, each dimension shows its sample size and "insufficient data" below a minimum `n`. |
| Player fields with provenance | A seat entry without a source is rejected. Source pass is available on seats, moves, edges and decisions. |
| Time slider on real timestamps | The board can be shown as of an earlier date from archived versions. |
| What-if (non-persisting scenario layer) | A scenario layer changes no stored card and can be attached to a decision. |
| Live channel (SSE) | Two open boards show a move within seconds, including agent proposals. |
| Model connectors | Ollama, a cloud model and an external decision-service stub answer through one `ModelConnector` shape. The answer arrives as a proposal. A cloud call needs gate clearance and per-transfer confirmation. |
| Source connectors | An Obsidian vault, a generic HTTP/JSON source, a document-management connector and later paid news services report new findings. They are referenced then pinned, with provenance, never ingested. |
| Training export | A JSONL file of decision traces contains only cards with `training: true`. |
| World collision on two local worlds | Two worlds overlaid on one question show shared, diverging and non-fitting cards without forcing consensus. |
| Level 1 thinking | Right after M1: a deterministic local `Level1Engine` predicts each player's next move when an assumption changes, shown as "engine estimates X" with the cards used, never as a verdict, escalatable to a board ([ADR-0035](./adr/0035-level1-engine-socket.md)). |

Later and out of scope here: a sharing platform, card-exchange economics, gamification and
crypto, and fine-tuning itself. The data model keeps ids, content hash, `level` and
`signature` reserved and builds nothing on them.

## Mapping of earlier plans onto the milestones

### Concept v1 phases 0 to 4

| Concept v1 phase | Content | Now |
| --- | --- | --- |
| 0 Click prototype | static design study | done as `prototype/board.html`, frozen. Superseded by the board app in M1. |
| 1 My world and board | cards, layers, stances, inbox ingest, three lenses, MCP read and propose | M1 for cards, layers, stances, edges, proposals, MCP. The ingest part is dropped (no ingestion). Lenses are M2+. |
| 2 Decide and follow up | decisions, forecasts, review, source profiles, barometer | M2+ slices: decision card, source profile, time slider. The barometer is replaced by the Rules panel. |
| 3 Several worlds and rules | overlays, rules from decisions, "what would I do" | M2+: rules panel, world collision, Level 1 thinking |
| 4 Platform | sharing, signature, federation | out of scope. Fields reserved. |

### Earlier cross-team roadmap (phases 0 to 5)

That plan was written around one particular store, so its items are mapped to the generic
product. Work specific to a particular store (its validator, its write channel and its
deployment) is delivered as a separate adapter outside this repository.

| Earlier phase and item | Maps to |
| --- | --- |
| **0 Foundation:** card format v2, typed edges, `lage` card, decision card with 11 fields, player fields | M0: [card format](./reference/card-format.md) and schemas |
| 0: validator and write channel v2 | store-specific, outside this repo. Conformance kit tests the contract any adapter must pass (M0 skeleton, M1 full). |
| 0: clean up the store | store-specific, outside this repo |
| 0: rebuildable search index | M1: derived index in the reference adapter |
| 0: visibility gate module | M0: `DisclosureGate` interface and `packages/disclosure-gate`. M1: blocks a private card for the cloud target. |
| **1 Board on the real store:** board API | M0: OpenAPI 3.1 contract. M1: implementation. |
| 1: live channel | M2+: live channel (SSE) |
| 1: create a Lage, place cards, save position | M1 |
| 1: decision card with 11 fields, outcome becomes experience | M2+: decision card slice |
| 1: rules panel replaces the meter, rules from rule cards | M2+: rules panel slice |
| 1: source pass everywhere | M1 counter, M2+ on seats, edges and decisions |
| 1: selective context package with cloud warning | M1 package and gate. M2+ confirmation flow with model connectors. |
| 1: training export v0 | M2+: training export slice |
| 1: written interface contract | M0: OpenAPI and MCP contract |
| **2 Own agents at the board:** MCP server, per-agent id and visibility | M0 contract, M1 implementation |
| 2: human gate, agent moves as proposals | M1: proposals |
| 2: brainstorm mode, "who sits at the table" | M2+ |
| **3 Models and first sources:** model connectors with one shape | M0 interface, M2+ implementations |
| 3: cloud confirmation, answer arrives as a card | M2+ with model connectors |
| 3: external decision-service connector | M2+ stub, always behind the gate |
| 3: source connectors, reference then pin | M2+: source connectors slice |
| **4 More sources, loop, several worlds:** more connectors, same-origin matching | M2+ |
| 4: outcome updates source statistics, multi-dimensional source rating | M2+: source profile slice |
| 4: several worlds, what-if, "does not fit" marker | M2+ |
| **5 Platform and training:** staged release, exchange, shared graph | out of scope here |
| 5: world collision with real shared cards | out of scope; collision of two local worlds is M2+ |
| 5: fine-tuning on decision traces | out of scope. Only the export exists. |

## MVP-critical acceptance criteria

An earlier audit compared a first UX prototype against the product definition (104
requirements) and found 33 that the minimum viable product must meet. They are the source of
the acceptance criteria below. The tests that prove them are tracked in
[verification](./verification.md). "Audit #" is the requirement's number in that audit.

### Product canon and model integrity

| ID | Criterion | Audit # | Milestone |
| --- | --- | --- | --- |
| AC-01 | The three layers (`evidenced`, `said`, `experience`) are never merged into one figure, and a stance is never folded into a layer or a count. Every number on the board decomposes into layers. | 11 | M1 |
| AC-02 | The user can classify any foreign statement with a private stance (`believed`, `rejected`, `undecided`, weight, note) without changing the card's layer. | 12 | M1 |
| AC-03 | The interface contains no verdict: no meter, no percentage, no highlighted "winning" option. The Rules panel lists fired and not fired rules with triggering cards only. | 62 | M2+ |
| AC-04 | The world's content types are visible and stored, including the user's own derivations and premises. | 5 | M1 |

### Persistence and storage

| ID | Criterion | Audit # | Milestone |
| --- | --- | --- | --- |
| AC-05 | The world stays with the user: state is written to files and survives a reload and a restart. | 6 | M1 |
| AC-06 | Cards come from the user's own store through a `StorageAdapter`, and each card shows which system it came from. | 3 | M1 |

### Board and situation

| ID | Criterion | Audit # | Milestone |
| --- | --- | --- | --- |
| AC-07 | The user can create a Lage with their own question and any number of options. | 30 | M1 |
| AC-08 | The user can draw, delete and reverse `supports` and `refutes` edges (both in M1), and they persist. | 31 | M1 |

### Decisions, rules and the loop

| ID | Criterion | Audit # | Milestone |
| --- | --- | --- | --- |
| AC-09 | A decision card stores all 11 sections and they survive a reload. | 23 | M2+ |
| AC-10 | The user creates and changes rule cards, and evaluation reads from those cards, never from code. | 25 | M2+ |
| AC-11 | Recording an outcome creates an experience card linked to the decision and to the cards used, it survives a reload, and source statistics update. | 50 | M2+ |
| AC-12 | A decision protocol exists across sessions, not only for the current one. | 99 | M2+ |
| AC-13 | The rationale of a decision is stored. | 101 | M2+ |

### Agents, models and interfaces

| ID | Criterion | Audit # | Milestone |
| --- | --- | --- | --- |
| AC-14 | The model is replaceable: each target is backed by a real connector, and switching it changes only the connector. | 1 | M2+ |
| AC-15 | The Worldbuilder is a layer a model can query. It is more than text to copy. | 2 | M1 |
| AC-16 | A database stores, an API supplies context, a model answers, and all three exist. | 32 | M1 |
| AC-17 | A model's answer returns to the board or the decision card as a proposal. | 33 | M2+ |
| AC-18 | The context pipeline selects relevant cards (request, active world, cards, relations, decisions, provenance, package) and hands over to a real target. | 78 | M1 |
| AC-19 | Relevance is chosen by the system from rules and cards, and a model can ask which assumptions, experiences and rules are relevant. | 26 | M2+ |
| AC-20 | The interface is model-independent. Several targets exist, and a user can add one. | 76 | M2+ |
| AC-21 | An agent queries the world itself (through MCP) and the user does not re-enter it. | 77 | M1 |
| AC-22 | Single cards can be added to and removed from a context package by the user. | 79 | M1 |
| AC-23 | A board API exists and the board is only a client of it. | 90 | M1 |
| AC-24 | The supporting infrastructure exists: API, storage and integrations (M1). Analytics (source statistics) arrive with the source-profile slice (M2+). Authentication is the local session token and per-agent tokens of [ADR-0026](./adr/0026-security-defaults.md); user accounts are deferred to platform work. | 84 | M1 |
| AC-25 | An external decision AI can be connected, at least as a stub behind the gate. | 89 | M2+ |

### Privacy and provenance

| ID | Criterion | Audit # | Milestone |
| --- | --- | --- | --- |
| AC-26 | Every world is private by default. The gate denies a private card for `cloud_model` by default; a cloud transfer happens only for gate-cleared cards and after the user confirms that transfer; the preview shows a cloud warning. | 66 | M1 |
| AC-27 | The user can see and control which private cards leave the device, and the world stays outside the model. | 80 | M1 |
| AC-28 | Player entries (interests, capabilities, dependencies, moves) need a source, or are left empty. | 47 | M2+ |
| AC-29 | The independence count is derived from the provenance chain, never typed in. | 70 | M1 |
| AC-30 | A source pass is available on every card, seat, edge and decision. | 93 | M2+ |
| AC-31 | Provenance is mandatory for players, moves, assumptions and decisions, and imported cards keep their original provenance. | 104 | M2+ |

### Organisation

| ID | Criterion | Audit # | Milestone |
| --- | --- | --- | --- |
| AC-32 | The project exists as its own repository with CI. | 98 | M0 |
| AC-33 | UX and architecture are separate documents with the links between them written down. | 88 | M0 |

Milestone column = the milestone in which the criterion is first expected to be demonstrated
by an automated test. Dates are not promised.
