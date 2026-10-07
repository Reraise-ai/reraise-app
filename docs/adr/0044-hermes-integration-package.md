---
status: accepted
date: 2026-10-07
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0044: The Hermes integration is a separate package with a stdlib-only native plugin

## Context and Problem Statement

[ADR-0037](0037-hermes-agents-as-mcp-clients.md) says every Hermes agent is a plain MCP client
and the product contains no Hermes-specific code. [ADR-0039](0039-knowledge-loop-receipts.md)
says the knowledge loop runs on mandatory, checked fields, because reminders changed nothing in a
measured multi-agent installation. Registering the MCP server is not enough for that: Hermes
hides MCP tools behind its tool search, nothing makes an agent consult before a task, and nothing
puts receipts into a hand-off or routes a memory write. Where does the Hermes-side glue live, in
what language, through which hooks, and what happens when it cannot do its job?

## Decision Drivers

- No Hermes-specific code in the core packages, the service or the MCP server
  ([ADR-0037](0037-hermes-agents-as-mcp-clients.md)); the integration is replaceable.
- Habits come from mandatory, checked fields; a failure must be visible, never a silent pass.
- The plugin runs inside the interpreter of the user's Hermes: no dependency to install there.
- Verified against the Hermes source, not guessed; testable in CI without installing Hermes.
- Safe defaults that do not break an agent system on day one.

## Considered Options

- A Hermes fork or a patch of its tool loop
- Prompt rules only (reminders), plus MCP registration
- Shell hooks in `config.yaml` (`hooks:` entries running commands)
- A native Hermes plugin (`plugin.yaml` plus `register(ctx)`) with templates, a reviewer skill
  and cron jobs, in its own package (chosen)

## Decision Outcome

Chosen option: "a native plugin in `integrations/hermes/`", because only a native plugin can call
an MCP server from inside a hook (`ctx.call_mcp`, default-deny through
`plugins.entries.<id>.mcp_allowlist`), rewrite tool arguments and block a tool call.

### Layout and licence

`integrations/hermes/` is Apache-2.0 ([LICENSING.md](../../LICENSING.md)) and contains
`plugins/worldbuilder-knowledge-loop/` (the plugin and its reviewer skill), `config/` (merge
snippet and a `.env` example with a placeholder), `templates/` (task, hand-off, task record),
`cron/` (installer and job scripts in sh and PowerShell) and `tests/` (a fake Hermes). It is
tested by `pnpm test:hermes` and its own CI job. The service side of the tools it calls is the
MCP server; the integration depends only on the tool contracts in `schemas/`.

### The plugin is Python, standard library only

Hermes loads a plugin into its own process, so the plugin must run on whatever Python the user's
Hermes has (3.11 or newer) without installing anything. It reads its settings through
`ctx.get_config` and the Hermes global config only for `plugins.hook_callback_timeout`. The
tests use `pytest`, `jsonschema`, `pyyaml` and `ruff`, which are not needed at run time.

### Hooks used and what each does

| Hook | Behaviour |
| --- | --- |
| `pre_llm_call` | Calls `knowledge_consult` on the first turn of a session and when the turn names another `Task ref:`, and appends the summary and the Knowledge Receipt id. A failed consult says so and states that no receipt exists; it is retried on the next turn. Pending notices (below) are delivered here once. |
| `pre_tool_call` on `delegate_task` | Normalises `action` like Hermes. For a spawn it adds an `output_schema` requiring `knowledgeReceipt`, `writeBackReceipt` and `cardWritten`, decodes `tasks` given as a JSON string, and leads each child goal with its own `Task ref: <child>`. An unknown shape is blocked. |
| `pre_tool_call` on `kanban_complete` | Blocks a hand-off whose metadata lacks the three fields. |
| `pre_tool_call` on `memory` | Routes each add or replace of target `memory` (a null target is `memory`) through `memory_route`. A card proposal goes to `knowledge_write_back` and the item is removed from the memory write; an ephemeral fact goes through. Target `user` is never sent. |
| `post_tool_call` | Notes receipts of `knowledge_consult` and `knowledge_write_back` that the model called itself. |
| `on_session_end`, `kanban_task_completed` | Write one task record per task (`taskRef`, agent, times, receipts known) to `task_records_dir` (default `<HERMES_HOME>/worldbuilder/task-records`), which the nightly validation and the metrics read. A task that never consulted gets a record without a receipt and fails verification, instead of being invisible. |
| system prompt section | A short rule; the checks do the work. |

### Defaults and fail modes

- Hermes abandons a `pre_tool_call` callback after `plugins.hook_callback_timeout` (30 s) and
  blocks the tool. The plugin keeps its Worldbuilder calls inside that timeout minus a margin.
- Consult failure: visible notice, no receipt, retry; the task cannot pass `wb receipts verify`.
- `memory_on_error: allow` (default): when the Worldbuilder cannot be reached the memory write
  goes ahead, nothing is lost; `block` is available. See OQ-16.
- `gate_kanban_complete: true` (default): a hand-off without receipts cannot complete. See OQ-17.
- `require_receipt_for_delegation: false` (default): delegation gets the contract fields but is not
  blocked while the parent has no receipt; the child's own receipt is still required. See OQ-18.
- Any other error in the hand-off check blocks (fail closed); in the memory gate it follows
  `memory_on_error`; an observer hook (records) logs and never raises.
- Logs and notices never contain memory text or card content; receipts carry ids and hashes only.

### Consequences

- Good, because consult, hand-off fields and memory routing happen in the tool loop, not by
  asking the model to remember them, and each is checked later by a program.
- Good, because the product stays Hermes-free; replacing Hermes means replacing this folder.
- Bad, because it depends on Hermes hook semantics (payload names, merge of `modify`), which can
  change; the fake Hermes copies them from a named source commit and a real-Hermes check is still
  needed.
- Bad, because writing outside the tool loop is not seen: a memory write that bypasses the
  `memory` tool (a background memory review fork, a provider writing directly) is not caught here;
  the nightly validation and the metrics reveal what it misses.
- Neutral: turning tool search off, which keeps the knowledge tools visible, is global in Hermes
  and costs context; the how-to documents the trade-off.

### Confirmation

`pnpm test:hermes` (`integrations/hermes/tests`): a fake Hermes loads `register(ctx)` and drives
the payloads above; the fake Worldbuilder validates every request and result against the JSON
Schemas, uses the real `rules:v3` classifier for `memory_route` and the real `wb receipts verify`
over what the plugin produced; the ADR-0042 secret corpus never reaches `knowledge_write_back`.
A real Hermes run is not part of CI.

## Pros and Cons of the Options

### Fork or patch Hermes

- Good, because anything could be enforced.
- Bad, because it must be maintained against every release and cannot be installed by a user.

### Prompt rules only

- Good, because trivial.
- Bad, because it is the measured failure.

### Shell hooks

- Good, because no Python.
- Bad, because a shell command cannot call `ctx.call_mcp`, so it needs its own MCP client and
  token handling, and `modify` of arguments is clumsy.

### Native plugin

- Good, because it is the supported extension point with default-deny MCP access.
- Bad, because it is code running in the user's Hermes process (kept small, stdlib only, no network
  other than through `ctx.call_mcp`).

## More Information

- Supersedes: nothing. Extends [ADR-0037](0037-hermes-agents-as-mcp-clients.md).
- Related: [ADR-0039](0039-knowledge-loop-receipts.md), [ADR-0040](0040-receipt-log-and-verifier.md),
  [ADR-0041](0041-usage-ledger-and-metrics.md), [ADR-0042](0042-memory-route-classification.md),
  [ADR-0043](0043-digest-atlas-regeneration.md), [ADR-0022](0022-public-hygiene.md).
- How-to: [Connect Hermes in 5 minutes](../how-to/connect-hermes.md).
