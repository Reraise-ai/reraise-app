# Owner questions

Product questions for the owner, with the default the project takes until the owner answers.
Work never waits for an answer: the safer default applies and is recorded here with its reason.
When the owner answers, the row moves to "Answered" and the linked ADR is updated or superseded.

## Answered

| ID | Question | Answer | Recorded in |
| --- | --- | --- | --- |
| OQ-1 | Does sharing a card need two steps (a gate rule and a per-card release), or is one enough? | Two steps; keep it. | [ADR-0036](./adr/0036-conclusions-are-private.md) |
| OQ-2 | May cards written by agents ever be shared with other people? | No; agent-originated cards stay never shareable for now. | [ADR-0036](./adr/0036-conclusions-are-private.md) |
| OQ-3 | Who adds the new player fields (red lines, assumed goals, personality type) to the owner's own card store? | The owner's store work, outside this repository. The repository keeps the mapping and the owner adapter note. | [ADR-0038](./adr/0038-player-fields-red-lines-goals-personality.md) |

## Open, with the default in force

| ID | Question | Default taken | Why this default | Recorded in |
| --- | --- | --- | --- | --- |
| OQ-4 | May agents record decisions and outcomes directly? | No: only as proposals (`decision_record`, `decision_outcome`); the human accepts. | Consistent with "nothing counts until a human accepts". | [ADR-0039](./adr/0039-knowledge-loop-receipts.md) |
| OQ-5 | Does "5 agent cards per week" count proposed or accepted cards? | Accepted agent cards (decided in the window); proposed ones are reported next to it. | Proposals alone can be gamed by volume; a card only counts as knowledge once a human accepted it (reviewer decision 2026-10-06). | [ADR-0041](./adr/0041-usage-ledger-and-metrics.md) |
| OQ-6 | Is "80 % of tasks with receipt" per agent or over all agents? | Over all agents (ratio of sums, rolling 7 days); per-agent values are shown. No tasks counts as not met. | One clear target; missing evidence must never look like success. | [ADR-0041](./adr/0041-usage-ledger-and-metrics.md) |
| OQ-7 | In which time zone do weeks start? | ISO 8601 weeks in UTC. | Same numbers on every machine and in CI. | [ADR-0041](./adr/0041-usage-ledger-and-metrics.md) |
| OQ-8 | What does "atlas older than 24 h" mean when no card changed? | Lag is 0 while every page is fresh; otherwise the age of the oldest stale page; a missing or extra page is stale, and a stale page without a usable time makes the lag unknown (target not met). | An unchanged, correct atlas is not out of date. | [ADR-0041](./adr/0041-usage-ledger-and-metrics.md), [ADR-0043](./adr/0043-digest-atlas-regeneration.md) |
| OQ-9 | Where does an unclear agent memory go? | Stays in the agent's memory (`ephemeral_ops_fact`); English keyword rules, other languages added per installation. | 30 to 40 proposals a night would bury the board. | [ADR-0042](./adr/0042-memory-route-classification.md) |
| OQ-10 | How old may a consult be for a task? | Within the task (from `startedAt`), or at most 24 hours before completion when no start is given; 5 minutes clock skew. | Short enough to mean "for this task", long enough for long tasks. | [ADR-0040](./adr/0040-receipt-log-and-verifier.md) |
| OQ-11 | Does a consult that needed a cloud confirmation, or found nothing, count? | Yes: `confirmation_required` and `nothing_found` are valid consults. | The habit of asking is what is checked, not a quota of cards. | [ADR-0039](./adr/0039-knowledge-loop-receipts.md) |
| OQ-12 | May a write-back give a free-text reason for "not needed"? | No: a closed list of reasons (`no_new_knowledge`, `already_covered` with card ids, `ephemeral_ops_fact`, `task_abandoned`). | Receipts never carry content. | [ADR-0039](./adr/0039-knowledge-loop-receipts.md) |
| OQ-13 | Are decisions with an open outcome exported for training? | No: only decisions with a known outcome. | A trace without an outcome teaches no decision style. | [ADR-0039](./adr/0039-knowledge-loop-receipts.md) |
| OQ-14 | Which cards may the atlas show to agents? | Only cards the gate rules allow for `local_model` (default target); never built for cloud models or other people. | The atlas is read by agents, so it passes the same gate as everything else. | [ADR-0043](./adr/0043-digest-atlas-regeneration.md) |
| OQ-15 | What does the board's "local model" context package target mean? | The option is labelled "Screen view of the package" (wire value `local_model`): the board session is a screen caller, so the service answers as `screen`. A registered local model gets its own gate-cleared package over its own connection. | Do not promise a model-specific preview before one exists (reviewer decision 2026-10-07). | `apps/board/README.md` |
| OQ-16 | When the Worldbuilder cannot be reached, is an agent's memory write allowed? | Allowed (`memory_on_error: allow`); `block` is a setting. | Nothing is lost, and an outage must not stop an agent system; the failure shows in the nightly checks. | [ADR-0044](./adr/0044-hermes-integration-package.md) |
| OQ-17 | Can an agent complete a kanban task without the receipts in the hand-off? | No (`gate_kanban_complete: true`). | A hand-off is where the habit is enforced; the message tells the agent what to do, including how to report a blocked task. | [ADR-0044](./adr/0044-hermes-integration-package.md) |
| OQ-18 | May an agent delegate while its own task has no Knowledge Receipt? | Yes, with the contract fields added (`require_receipt_for_delegation: false`). | Blocking delegation on an outage would stop all work; the missing receipt is caught by verification. | [ADR-0044](./adr/0044-hermes-integration-package.md) |
