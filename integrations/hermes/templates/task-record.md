---
# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# Minimal task record for `wb receipts verify` (schemas/task-record.schema.json), for a reviewer
# agent that writes the record from a hand-off (skills/reviewer/SKILL.md). Values exactly as in the
# hand-off. Only taskRef, agent and completedAt are required by the schema; a record without the
# receipts is still read and the verifier reports them as `missing`.
taskRef: "{{taskRef}}"
agent: "agent:{{agent}}"
startedAt: "{{startedAt}}"
completedAt: "{{completedAt}}"
knowledgeReceipt:
  receiptId: "{{receiptId}}"
  hash: "{{hash}}"
writeBackReceipt:
  receiptId: "{{receiptId}}"
  hash: "{{hash}}"
---

Reviewed hand-off of {{taskRef}}.
