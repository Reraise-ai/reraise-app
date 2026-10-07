---
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Hand-off of one agent task. The front matter is a task record (schemas/task-record.schema.json)
# that `wb receipts verify` reads directly: save the file in the task records folder. Copy the
# receipt ids and hashes from the results of knowledge_consult and knowledge_write_back; do not
# type them from memory and never invent them.
taskRef: "{{taskRef}}"
agent: "agent:{{agent}}"
startedAt: "{{startedAt, RFC 3339 UTC, e.g. 2026-10-05T08:59:00Z}}"
completedAt: "{{completedAt, RFC 3339 UTC}}"
knowledgeReceipt:
  receiptId: "{{receiptId of knowledge_consult}}"
  hash: "{{hash of knowledge_consult, sha256:...}}"
writeBackReceipt:
  receiptId: "{{receiptId of knowledge_write_back}}"
  hash: "{{hash of knowledge_write_back, sha256:...}}"
---

# Hand-off: {{title}}

Task ref: {{taskRef}}

## Result

{{what was done and found; link card ids rather than pasting their content}}

## Knowledge loop (all three lines are mandatory; a hand-off missing one is rejected)

Knowledge receipt: {{receiptId}} {{hash}}

Write-back receipt: {{receiptId}} {{hash}}

Card written: {{proposalId or cardId}} | not needed because: {{no_new_knowledge | already_covered | ephemeral_ops_fact | task_abandoned}}

Keep exactly one alternative on the `Card written` line. A proposal id is what exists at hand-off
time (the card gets its own id when the human accepts it).

## Open questions

- {{anything the next agent or the human must decide}}
