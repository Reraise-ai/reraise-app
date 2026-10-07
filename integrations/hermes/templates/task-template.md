<!--
SPDX-License-Identifier: Apache-2.0
Copyright The Worldbuilder contributors

Task template for Hermes agents and orchestrators. Copy, fill the {{placeholders}}, and use it as
the text of a delegated task or a kanban card. Why the two mandatory fields exist:
docs/explanation/receipts-not-reminders.md.
-->

# {{title}}

Task ref: {{taskRef}}
Assigned to: agent:{{agent}}

The `Task ref:` line is read by the Worldbuilder plugin: it consults the knowledge for exactly this
task reference. Use an opaque id (letters, digits and `. _ : / # -`, at most 128 characters, no
spaces, no `//`), never a title, a path or a link.

## Goal

{{what the agent must achieve, in one or two sentences}}

## Done when

- {{acceptance criterion}}

## Knowledge loop (mandatory, checked by `wb receipts verify`)

1. **Knowledge receipt.** The turn context starts with a `Knowledge receipt:` line (id and hash).
   If it says the consult failed, say so in the hand-off; do not invent a receipt.
2. **Card written: id | not needed because ...** Before you finish, call `knowledge_write_back`
   with this Task ref: propose one card with what the task taught, or give a coded reason that no
   card is needed (`no_new_knowledge`, `already_covered`, `ephemeral_ops_fact`, `task_abandoned`).
3. Hand off with `templates/handoff-template.md`. Work without both receipts is rejected.
