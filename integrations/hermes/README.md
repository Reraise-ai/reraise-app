# Worldbuilder for Hermes

Native Hermes plugin, config and cron templates, task and hand-off templates, a reviewer skill
and a fake-Hermes test harness. Licence: Apache-2.0.

Start with [Connect Hermes in 5 minutes](../../docs/how-to/connect-hermes.md).

| Folder                                 | Content                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `plugins/worldbuilder-knowledge-loop/` | the plugin (`plugin.yaml`, `register(ctx)`), standard library only              |
| `config/`                              | `config.snippet.yaml`, `.env.example` (placeholder only)                        |
| `templates/`                           | task, hand-off and task record templates                                        |
| `cron/`                                | install scripts and job scripts (sh and PowerShell)                             |
| `tests/`                               | pytest suite with a fake Hermes and a fake Worldbuilder; run `pnpm test:hermes` |
