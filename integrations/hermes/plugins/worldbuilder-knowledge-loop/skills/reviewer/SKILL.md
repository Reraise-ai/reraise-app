---
name: reviewer
description: 'Review agent work against the Worldbuilder knowledge loop: run wb receipts verify and reject work without valid receipts.'
version: 0.1.0
author: The Worldbuilder contributors
license: Apache-2.0
metadata:
  hermes:
    tags: [review, worldbuilder, receipts]
prerequisites:
  commands: [wb]
---

<!--
SPDX-License-Identifier: Apache-2.0
Copyright The Worldbuilder contributors
-->

# Worldbuilder reviewer

You review the hand-off of one agent task before it is accepted. Your decision about the
knowledge loop is made by a program, not by you: `wb receipts verify`. You never judge a receipt
by reading it, and you never fix a hand-off by writing a receipt yourself.

## When to use

- A task, delegation or kanban card is handed to you for review or acceptance.
- A nightly or CI job asks you to check the day's task records.

## Procedure

1. Find the hand-off. It names `Task ref`, the agent (`agent:<name>`), and the fields
   `Knowledge receipt`, `Write-back receipt` and `Card written`. If any of the three fields is
   absent or empty, stop: **REJECT** with the reason `missing hand-off field`.
2. Write a task record (see `templates/task-record.md` of the integration) as a file in a scratch
   directory. Copy the values exactly as given in the hand-off; do not complete, correct or
   normalise them:

   ```markdown
   ---
   taskRef: <Task ref>
   agent: agent:<name>
   startedAt: <when the task started, RFC 3339, if known>
   completedAt: <when the task was handed off, RFC 3339>
   knowledgeReceipt: { receiptId: <id>, hash: <hash> }
   writeBackReceipt: { receiptId: <id>, hash: <hash> }
   ---
   ```

3. Run the verifier against the receipt log of the Worldbuilder device:

   ```sh
   wb receipts verify <scratch-dir> --json
   ```

   Add `--log <path>` if the log is not in the default state directory, and `--head <hash>` if
   you pinned the log head earlier.

4. Decide by the exit code only:

   | Exit code | Decision                       | What you report                                                                                                                                            |
   | --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 0         | accept the knowledge-loop part | "receipts valid" and the two receipt ids                                                                                                                   |
   | 1         | **REJECT**                     | each failing slot and its code (`missing`, `unknown`, `forged`, `wrong_kind`, `wrong_agent`, `wrong_task`, `stale`, `out_of_window`, `reused`, `unlinked`) |
   | 2         | **REJECT**, cannot verify      | the usage problem (unreadable file, not a task record, no file)                                                                                            |
   | 3         | **REJECT** and alert the human | the receipt log is broken (tamper evidence); every task fails                                                                                              |

5. A rejection names what the author must do: consult and write back through the Worldbuilder
   tools for the same `Task ref`, then hand off again with the new receipts. If the consult could
   not happen (service unreachable), the correct hand-off says so and the task is **blocked**, not
   accepted.

## Rules

- No exit code 0, no acceptance. A missing `wb`, a missing log and an unreachable service are
  rejections, never exceptions.
- Receipts carry ids and hashes only. Do not ask the author to paste task text or card content
  into the review.
- `Card written` is for the human reader. The verifier checks the Write-back Receipt; compare the
  two only to point out a contradiction (a card claimed while the receipt says `not_needed`).
- Whether the proposed card is good is the human's decision on the board, not yours.
