# Why receipts, not reminders

The Worldbuilder only helps if agents actually use the user's knowledge and give back what they
learn. This page explains why the project enforces that with receipts that a program checks,
and not with reminders in prompts. The binding rules are in
[ADR-0039](../adr/0039-knowledge-loop-receipts.md) to
[ADR-0043](../adr/0043-digest-atlas-regeneration.md).

## What was measured

A multi-agent installation that already had a card store and a knowledge search tool was
measured from its own tool-call logs:

- the orchestrating agent consulted the knowledge in 1.4 % of its tool calls; all other agents
  together in 2 of 21,334;
- for days no agent wrote a single card;
- a nightly memory job wrote 30 to 40 learnings a day into a separate memory database instead
  of the card store;
- the atlas, the summary pages agents use for orientation, was days out of date;
- the search tool sat behind a generic tool search, so agents rarely saw it;
- adding reminders before every step ("consult the knowledge first") changed nothing.

The knowledge was there. The habit was not.

## Why reminders fail

A reminder is one more sentence in a long prompt. It competes with the task, it costs nothing to
ignore, and nobody notices when it is ignored. An agent that skips the knowledge produces work
that looks the same as work that used it. Without a check, "please consult" is a wish.

## What a receipt changes

A receipt turns the habit into a field that must be filled and can be checked:

1. At the start of a task the agent calls `knowledge_consult`. It gets the context package, built
   through the same disclosure gate as every other read, and a **Knowledge Receipt**: an id, the
   task reference, a hash of the question, the ids of the cards it received (or "nothing found"),
   a time and a hash.
2. At the end the agent calls `knowledge_write_back`. Either it proposes a card (the human still
   accepts or rejects it) or it says why no card is needed, from a short fixed list. It gets a
   **Write-back Receipt**.
3. The hand-off of the task cites both receipts by id and hash.
4. A reviewer agent or CI runs `wb receipts verify`. It looks each receipt up in the receipt log,
   which only the local service writes, and rejects the task if a receipt is missing, unknown,
   forged, stale, for another task or agent, or if the log was tampered with.

The check does not demand that cards were found or written. "Nothing found" and "not needed,
already covered by these cards" are honest, valid answers. What it demands is that the question
was asked and the decision was made, for every task.

## Why receipts carry no content

A receipt holds ids, hashes, fixed codes and times: never the task text, a card title, or a
free-text reason. That is deliberate:

- receipts are pasted into hand-offs, kept by reviewer agents and checked in CI, places that the
  disclosure gate does not guard;
- a hash of the question still proves which question was asked, without revealing it;
- card ids are already visible to the same agent in its context package.

The receipt log is chained: each line holds the hash of the previous one. Editing, deleting,
inserting or reordering a line breaks the chain, and the verifier then rejects every task until
a human repairs the log. An agent cannot write the log at all.

## The rest of the loop

Receipts make consulting and writing back visible. Three more parts close the loop:

- **Memory routing.** The agent system's memory job asks `memory_route` for each item whether it
  is durable knowledge (propose a card) or an operational fact (keep it in the agent's memory).
  Fixed rules decide, so secrets and machine details never become card proposals, and the human
  is not buried in 40 proposals a night.
- **Atlas.** `wb digest` rebuilds the summary pages from the cards, with every line linking the
  card ids it rests on, and reports a page as stale as soon as one of its cards changes.
- **Metrics.** `wb metrics` and the board show, per agent and week, the share of tasks with valid
  receipts, the cards proposed and accepted, decisions with an outcome and the atlas lag, against
  the owner's targets. Missing evidence is never counted as success.

## What receipts do not do

- They do not make agent output count: proposals still need a human
  ([ADR-0011](../adr/0011-agent-moves-are-proposals.md)).
- They do not move content anywhere: the context package behind a consult passes the disclosure
  gate like any other read ([ADR-0012](../adr/0012-disclosure-gate.md)).
- They do not judge quality. A receipt proves that knowledge was asked for and a decision about
  writing back was made; whether the work was good is still the reviewer's call.
