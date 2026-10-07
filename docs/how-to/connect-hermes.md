# Connect Hermes in 5 minutes

This guide wires a Hermes agent system into the knowledge loop: agents consult the Worldbuilder
before a task, hand off with receipts, route memory writes, and a reviewer and nightly jobs check
the result. It builds on [Connect a Hermes agent](./connect-hermes-agent.md) (registering one
agent and its token) and on [ADR-0037](../adr/0037-hermes-agents-as-mcp-clients.md),
[ADR-0039](../adr/0039-knowledge-loop-receipts.md) and
[ADR-0040](../adr/0040-receipt-log-and-verifier.md). Everything lives in
`integrations/hermes/` of the repository (Apache-2.0).

::: tip Why a plugin and checked fields
A measured multi-agent installation showed that reminders change nothing: agents consulted
knowledge in about 1 % of tool calls, wrote no cards for days, and filed lessons into a separate
memory instead. Habits come from mandatory, checked fields. The plugin makes the consult
automatic, the hand-off fields required, and `wb receipts verify` the only judge.
:::

::: warning Status
The plugin, templates and cron scripts are tested against a fake Hermes harness in CI, not
against a running Hermes. The service side of the tools `knowledge_consult`,
`knowledge_write_back` and `memory_route` is a separate slice; until it ships, the plugin reports
"no receipt" and the verifier rejects the task, which is the intended failure mode.
:::

## 1. Register the agent and its token (1 minute)

```sh
worldbuilder agent add orchestrator --target local_model   # or cloud_model, see the other guide
```

Put the printed token into `~/.hermes/.env` with owner-only permissions (one token per agent,
never in a repository or on a command line):

```sh
cat integrations/hermes/config/.env.example >> ~/.hermes/.env   # then replace the placeholder
chmod 600 ~/.hermes/.env
```

## 2. Configure Hermes (1 minute)

Merge `integrations/hermes/config/config.snippet.yaml` into `~/.hermes/config.yaml`:

- `mcp_servers.worldbuilder`: Streamable HTTP at `http://127.0.0.1:4310/mcp` with
  `Authorization: Bearer ${WORLDBUILDER_AGENT_TOKEN}`. Change the port if you did.
- `tools.tool_search.enabled: "off"`: Hermes hides every MCP tool behind its tool search by
  default, and `defer: []` does not undefer MCP tools. Off is global, so every MCP and plugin tool
  costs context in every turn. Narrow the surface with `tools.include` (the snippet lists the
  eleven tools an orchestrator needs) and on your other MCP servers. If that cost is too high,
  keep tool search on with `listing: "on"` and a large `listing_max_tokens`; consult and the
  hand-off fields still work through the plugin, but expect fewer write-backs.
- `plugins.entries.worldbuilder-knowledge-loop.mcp_allowlist: [worldbuilder]`: Hermes denies a
  plugin every MCP server that is not listed.
- `settings.world_id`: the ULID of the world agents consult (from `world_list`).

## 3. Install the plugin (1 minute)

```sh
cp -r integrations/hermes/plugins/worldbuilder-knowledge-loop ~/.hermes/plugins/
hermes plugins enable worldbuilder-knowledge-loop
```

What it does:

| Hook | Behaviour |
| --- | --- |
| `pre_llm_call` | On the first turn of a task and when the task changes it calls `knowledge_consult` and injects the summary and the Knowledge Receipt id. Server unreachable: an explicit notice and "no receipt"; it never pretends. |
| `pre_tool_call` on `delegate_task` | Adds an `output_schema` that requires `knowledgeReceipt`, `writeBackReceipt` and `cardWritten` (`{cardId}` or `{notNeededBecause}`); optionally blocks delegation without a consult. |
| `pre_tool_call` on `kanban_complete` | Blocks a hand-off whose metadata lacks the receipts and `cardWritten`. |
| `pre_tool_call` on `memory` | `memory_route`: a durable lesson becomes a private card proposal through `knowledge_write_back` and the memory write is blocked; an ephemeral operations fact is allowed. |
| system prompt section | A short rule: consult first, hand off with receipts, lessons are cards. |

## 4. Use the templates (1 minute)

`integrations/hermes/templates/` holds the task template, the hand-off template and the task
record. Both templates have the mandatory lines **Knowledge receipt** and **Card written: id |
not needed because ...**. A hand-off is saved as a task record in the folder the nightly job
reads. The plugin's `reviewer` skill rejects any hand-off for which `wb receipts verify` does not
exit 0.

## 5. Install the cron jobs (1 minute)

```sh
sh integrations/hermes/cron/install-cron.sh --dry-run     # prints every step
sh integrations/hermes/cron/install-cron.sh --deliver local
# edit $HERMES_HOME/scripts/worldbuilder-loop.conf (store, task record folder)
```

On Windows use `integrations/hermes/cron/install-cron.ps1` (same options). Four no-agent jobs are
created with `hermes cron create`, scripts in `$HERMES_HOME/scripts/`:

| Job | Schedule | What it does |
| --- | --- | --- |
| `worldbuilder-nightly-digest` | `17 2 * * *` | `wb digest` regenerates the atlas pages |
| `worldbuilder-nightly-validate` | `37 3 * * *` | `wb receipts verify` over the day's task records |
| `worldbuilder-weekly-metrics` | `23 7 * * MON` | `wb metrics`: tasks with receipt, cards proposed and accepted, atlas lag |
| `worldbuilder-watchdog` | `41 6 * * *` | speaks only when the atlas is older than 3 days or no agent card was accepted for a week |

Check with `hermes cron list` and `hermes cron doctor`.

## Verify it works

1. Start a task. The first turn shows the consult summary with a Knowledge Receipt id; stop the
   service and start another task: the turn shows the "no receipt" notice instead.
2. Hand a task off without the `Knowledge receipt` line: the hand-off is blocked or the reviewer
   rejects it.
3. Run the plugin tests without Hermes: `pip install -e "integrations/hermes[test]"` and
   `pnpm test:hermes`.

## Known limits

- Whether Hermes' background memory review path passes through `pre_tool_call` is not verified;
  the nightly validation and the metrics catch what it misses.
- Hooks are abandoned after `plugins.hook_callback_timeout` (30 s) and then fail closed; the
  plugin keeps its own call budget inside it.
- A receipt proves that a consult happened for a task, not that the agent used it well; the
  quality of a proposed card is the human's decision on the board.
