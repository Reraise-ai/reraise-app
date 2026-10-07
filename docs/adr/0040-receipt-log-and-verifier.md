---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0040: A hash-chained receipt log on the device and a verifier that fails closed

## Context and Problem Statement

[ADR-0039](0039-knowledge-loop-receipts.md) gives every consult and every write-back decision a
receipt. A receipt an agent pastes into a hand-off proves nothing by itself: the agent could
invent one with a correct self-hash. The check needs a record the agent cannot write, a defined
notion of "valid for this task", and a command that a reviewer agent or CI can run. Where is
that record, how is tampering detected, and what exactly does the verifier accept?

## Decision Drivers

- Agents never write local state ([ADR-0030](0030-local-state-on-the-device.md)); the service is
  the only writer ([ADR-0029](0029-process-topology.md)).
- Files are the truth, readable and append-only where history matters
  ([ADR-0006](0006-files-are-the-truth.md)).
- Partial edits, deletions and reordering of the record must be detectable.
- The check must run without the service: in a reviewer agent and in CI.
- Apache-2.0 tooling must not import AGPL code ([ADR-0004](0004-two-tier-licensing.md)).

## Considered Options

- Trust the receipt's self-hash (no log)
- Sign receipts with a service key (HMAC or asymmetric)
- An append-only, hash-chained JSON Lines log in the state directory, checked by a verifier
  library and a command line (chosen)

## Decision Outcome

Chosen option: "hash-chained JSON Lines log plus verifier", because it is plain files, needs no
key management, detects every edit except a consistent rewrite of the tail (see below), and
runs anywhere the log file is readable.

### The log

- File: `<state>/receipt-log.jsonl` (extends the layout of
  [ADR-0030](0030-local-state-on-the-device.md)). Written only by the service, one line per
  receipt, never rewritten, never rotated: rotation would cut the chain. A receipt is a few
  hundred bytes; a year of heavy use stays in the tens of megabytes.
- Entry (`schemas/receipt-log-entry.schema.json`): `{v: 1, seq, at, prev, receipt, hash}`.
  `seq` starts at 0 and increases by one; `prev` is the `hash` of the previous entry, for the
  first entry `sha256:` followed by 64 zeros; `receipt` is a Knowledge or Write-back Receipt;
  `hash` is `hashJcs` of the entry without `hash` ([ADR-0034](0034-content-hash.md)).
- The log holds no content: receipts are content-free by contract
  ([ADR-0039](0039-knowledge-loop-receipts.md)), and the entry adds only numbers, times and
  hashes. It is local state: never sent to a model, exported or shared.
- Appends go through one writer with an in-process mutex. The writer refuses a receipt whose
  `receiptId` is already in the log. At open the writer verifies the whole
  chain; if it is broken it refuses to append and reports the first broken line, so a damaged
  log is never extended. Repair is a human act: move the file aside; a new chain starts at
  `seq` 0. Receipts of the old file then no longer verify, which is correct: their evidence is
  gone.
- `packages/knowledge-loop` implements the log against an injected port
  (`ReceiptLogPort`: read all lines, append one line), plus a file port for the service and the
  command line.

### One writer, and a writer that notices outside changes

- The service takes a lock file `<state>/service.lock` (pid, a hash of the host name, a token)
  before it writes anything in the state directory. A second `worldbuilder serve` on the same
  state directory refuses to start. A lock whose holder is a dead process on the same host is
  stale and is taken over; the lock of a live process, or of another host (a shared directory), is
  never broken. This also protects the session token, the proposals and the gate log.
- Before each append, and before a consult prepares any content, the writer compares the file with
  what it last wrote (size, modification time and file id, taken after its own last append). Any
  difference makes it open the log again with the full chain check: a broken chain answers 503
  ("Receipt log unavailable") and nothing is delivered or appended; a file that was moved aside
  starts a fresh chain at `seq` 0. A change that keeps size, time and file id unchanged is not
  noticed until the next open; the verifier still detects it.

### Tamper evidence and its limit

The chain detects a changed, inserted, deleted or reordered entry anywhere before the last one,
a changed receipt inside an entry, and a broken last line. It cannot detect someone with write
access to the state directory rewriting the tail consistently (recomputing every hash after the
change). That actor can also change the gate rules; the threat the log addresses is an agent
claiming a consult it did not make, and agents never get write access to the state directory.
The verifier accepts an expected head hash (`--head`) so a reviewer can pin the head it saw
earlier and detect a later rewrite.

### Task records

A hand-off cites its receipts in a task record (`schemas/task-record.schema.json`): `taskRef`,
`agent`, optional `startedAt`, `completedAt`, and `knowledgeReceipt` / `writeBackReceipt`, each
`{receiptId, hash}`. Both receipts are optional in the schema so that a record without them
validates and the verifier, not the parser, reports them as missing. A task record is a JSON file
or a Markdown file whose YAML front matter holds the same keys.

### Verifier semantics

`verifyReceipts(taskRecords, logLines, options)` in `packages/knowledge-loop`, fail closed:

1. The chain is checked first. Any unparsable line, schema-invalid entry, wrong `seq`, wrong
   `prev`, wrong entry hash, wrong receipt hash, duplicate `receiptId` or head mismatch makes
   the log broken, and every task fails with `chain_broken`.
2. Every time (`startedAt`, `completedAt`, each receipt's `at`) is parsed once, strictly as
   RFC 3339 (no leap second, no out-of-range offset or date). A task record whose own times
   cannot be represented, or whose `startedAt` is after `completedAt`, fails with
   `invalid_time` (slot `task`) and its receipts are not checked.
3. For each task record and each of its two receipts, the first failing check wins:

| Code | Meaning |
| --- | --- |
| `missing` | the record does not cite this receipt |
| `unknown` | no log entry has this `receiptId` |
| `forged` | the cited `hash` differs from the logged receipt's hash |
| `wrong_kind` | a knowledge slot cites a write-back receipt or the reverse |
| `wrong_agent` | the receipt's agent is not the record's agent |
| `wrong_task` | the receipt's `taskRef` is not the record's |
| `invalid_time` | the receipt's `at` cannot be represented |
| `stale` | the receipt is older than the task window: before `startedAt`, or, without `startedAt`, more than `maxAgeHours` (default 24) before `completedAt` |
| `out_of_window` | the receipt is after `completedAt`, or the write-back is before the consult |
| `reused` | an earlier task record already cited this `receiptId` |
| `unlinked` | the write-back receipt names a `consultReceiptId` other than the record's knowledge receipt |

   Times are compared with a clock-skew tolerance (default 300 seconds).

   `reused` is detected within one verifier run only. A receipt cited by two task records that
   are verified in separate runs (two CI jobs over different task sets) is not caught; a
   reviewer that needs this guarantee verifies the complete set of task records of the period
   in one run, as `wb metrics --tasks` does.
4. A task is valid when both receipts pass. Every `result` counts: `nothing_found`,
   `confirmation_required` and `not_needed` are honest answers, and the point is the habit of
   asking and deciding, not a quota.

### Command line `wb`

`packages/knowledge-loop` ships a small Apache-2.0 binary `wb` that reads files only and never
starts or contacts the service (the `worldbuilder` command of ADR-0029 stays the service's):

- `wb receipts verify <taskfile|dir>... --log <path> [--head <hash>] [--max-age-hours n]
  [--skew-seconds n] [--json]`. Exit codes: **0** every task record has valid receipts; **1** at
  least one task record failed; **2** usage error, unreadable input, a task file that is not a
  valid task record, or no task files; **3** the receipt log is broken (tamper evidence).
- `wb digest` and `wb metrics` are defined in [ADR-0043](0043-digest-atlas-regeneration.md) and
  [ADR-0041](0041-usage-ledger-and-metrics.md).
- Default `--log` is `<state>/receipt-log.jsonl`, resolved like the service does
  ([ADR-0030](0030-local-state-on-the-device.md)).

### Consequences

- Good, because a reviewer agent or CI can reject work without valid receipts by exit code.
- Good, because the log is human-readable and audit-friendly, and holds no content.
- Bad, because a consistent tail rewrite by someone with state-directory access is not
  detectable without a pinned head.
- Bad, because the log is never rotated; if it grows too large, an ADR adds chained segments.

### Confirmation

`packages/knowledge-loop` tests: append and verify a chain; every tamper case (edited receipt,
edited entry, deleted, inserted, reordered, truncated, duplicate id, head mismatch) is detected;
the writer refuses to append to a broken log; every verifier code has a failing case and the
happy path passes; the command line returns each documented exit code. Schema fixtures for log
entries and task records (valid and invalid).

## Pros and Cons of the Options

### Self-hash only

- Good, because nothing to store.
- Bad, because any agent can mint a receipt.

### Signed receipts

- Good, because forgery needs the key.
- Bad, because key storage and rotation on every device; a log is still needed to detect
  omissions and reuse.

### Hash-chained log

- Good, because plain files and no keys.
- Bad, because a consistent tail rewrite needs a pinned head to detect.

## More Information

- Supersedes concept v1: nothing (concept v1's event log was replaced by files in
  [ADR-0006](0006-files-are-the-truth.md); this log is audit state, not card truth).
- Extends the state layout of [ADR-0030](0030-local-state-on-the-device.md).
- Related: [ADR-0039](0039-knowledge-loop-receipts.md),
  [ADR-0041](0041-usage-ledger-and-metrics.md).
