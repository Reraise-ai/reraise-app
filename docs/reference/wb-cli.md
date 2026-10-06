# The `wb` command line

`wb` is the small, offline command line of the knowledge loop, shipped by
`packages/knowledge-loop` (Apache-2.0). It reads files only: it never starts or contacts the
Worldbuilder service, never writes local state, and writes nothing but atlas pages. The service
and its own command, `worldbuilder`, are separate ([ADR-0029](../adr/0029-process-topology.md)).
Decisions: [ADR-0040](../adr/0040-receipt-log-and-verifier.md),
[ADR-0041](../adr/0041-usage-ledger-and-metrics.md),
[ADR-0043](../adr/0043-digest-atlas-regeneration.md).

Every command takes `--state <dir>` to use another state directory than the per-user default
(`$XDG_STATE_HOME/worldbuilder`, `%LOCALAPPDATA%\Worldbuilder` or
`~/Library/Application Support/Worldbuilder`, [ADR-0030](../adr/0030-local-state-on-the-device.md)).

## `wb receipts verify`

```sh
wb receipts verify <taskfile|dir>... [--log <file>] [--head <hash>]
                   [--max-age-hours <n>] [--skew-seconds <n>] [--json]
```

Checks that every task record cites a valid Knowledge Receipt and a valid Write-back Receipt
in the receipt log. Meant for a reviewer agent or a CI step that rejects work without receipts.

| Option | Meaning | Default |
| --- | --- | --- |
| `<taskfile\|dir>` | task records: `.json` files, or `.md` files whose YAML front matter holds the record; directories are searched recursively | required |
| `--log` | the receipt log | `<state>/receipt-log.jsonl` |
| `--head` | the head hash you pinned earlier; a different head means the log tail was rewritten | none |
| `--max-age-hours` | how long before `completedAt` a consult may be when the record has no `startedAt` | 24 |
| `--skew-seconds` | clock-skew tolerance for every time comparison | 300 |
| `--json` | print the report as JSON (chain status and per-task problems) | text |

| Exit code | Meaning |
| --- | --- |
| 0 | every task record has valid receipts |
| 1 | at least one task record failed; the output names slot and code (`missing`, `unknown`, `forged`, `wrong_kind`, `wrong_agent`, `wrong_task`, `stale`, `out_of_window`, `reused`, `unlinked`) |
| 2 | usage error, an unreadable file, a file that is not a valid task record, or no task files |
| 3 | the receipt log is broken (unparsable line, invalid entry, chain break, duplicate receipt, head mismatch): tamper evidence, every task fails |

A missing log file counts as an empty log: every cited receipt is then `unknown` (exit 1).

A task record (`schemas/task-record.schema.json`) as Markdown front matter:

```markdown
---
taskRef: TASK-2026-0042
agent: agent:research-helper
startedAt: 2026-10-05T08:59:00Z
completedAt: 2026-10-05T09:31:00Z
knowledgeReceipt:
  receiptId: 01M1KM00000000000000000001
  hash: sha256:<64 hex digits from the knowledge_consult result>
writeBackReceipt:
  receiptId: 01M1KM00000000000000000002
  hash: sha256:<64 hex digits from the knowledge_write_back result>
---

Hand-off notes for the reviewer.
```

## `wb digest`

```sh
wb digest --store <dir> [--out <dir>] [--target screen|local_model|demo]
          [--gate-rules <file>] [--check]
```

Rebuilds the atlas pages of a `markdown-files` store deterministically: one page per world plus
one for cards without a world, each line linking the card ids it rests on. Cards are filtered by
the disclosure gate for the target. Generated pages that the current cards and rules no longer
produce are removed; other files in the output directory are never touched.

| Option | Meaning | Default |
| --- | --- | --- |
| `--store` | the store directory (read-only: no watcher, no lock) | required |
| `--out` | where `<pageId>.json` (page model) and `<pageId>.md` are written | `<state>/atlas` |
| `--target` | the gate target the atlas is built for; `cloud_model` and `share` are refused | `local_model` |
| `--gate-rules` | the gate rule file; without one, default deny leaves the atlas empty | `<state>/gate-rules.yaml` |
| `--check` | write nothing; compare the existing pages with the store | off |

| Exit code | Meaning |
| --- | --- |
| 0 | pages written; with `--check`: every page is fresh |
| 1 | with `--check`: at least one page is stale (a card changed, was removed or added), missing, or extra (no longer produced by the current cards and rules) |
| 2 | usage error, an unreadable store, or a refused target |

## `wb metrics`

```sh
wb metrics [--week YYYY-Www] [--log <file>] [--tasks <dir>] [--proposals <dir>]
           [--store <dir>] [--atlas <dir>] [--atlas-target <target>] [--gate-rules <file>] [--target id=value]...
           [--now <iso>] [--json] [--check]
```

Computes the knowledge-loop metrics of [ADR-0041](../adr/0041-usage-ledger-and-metrics.md) per
agent for an ISO week (UTC) or, without `--week`, for the 7 days before now, plus the owner's
targets.

| Option | Meaning | Default |
| --- | --- | --- |
| `--week` | an ISO week, for example `2026-W41` | rolling 7 days |
| `--log` | the receipt log | `<state>/receipt-log.jsonl` |
| `--tasks` | directory of task records (the denominator of receipt coverage) | none |
| `--proposals` | directory of proposal files | `<state>/proposals` |
| `--store` | the store, for decisions with an outcome and atlas freshness | none |
| `--atlas` | the atlas pages | `<state>/atlas` |
| `--atlas-target` | the gate target the atlas was built for | `local_model` |
| `--gate-rules` | the gate rule file used for atlas freshness | `<state>/gate-rules.yaml` |
| `--target id=value` | override a target: `receipt_coverage_7d`, `agent_cards_7d`, `atlas_lag_hours`, `decisions_with_outcome` | 0.8, 5, 24, 10 |
| `--now` | the time to compute for (reproducible runs) | the current time |
| `--json` | print the `UsageMetrics` document (`schemas/usage-metrics.schema.json`) | text |
| `--check` | fail when a target is not met (for a watchdog job) | off |

| Exit code | Meaning |
| --- | --- |
| 0 | done; with `--check`: every target is met |
| 1 | with `--check`: at least one target is not met (a target without a value, such as no tasks or no atlas, is not met) |
| 2 | usage error or unreadable input |
| 3 | the receipt log is broken |
