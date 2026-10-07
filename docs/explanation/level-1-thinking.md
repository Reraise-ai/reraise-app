# Level 1: a quick guess, never a verdict

> A fast estimate of what each player will probably do next, shown with its author and its
> reasons, so that you can think about it, not so that you can stop thinking.

## What it is for

The board is where you think slowly: you place cards, draw links, weigh options. Sometimes you
want a quick sense of direction first. If I assume the navy keeps its night restrictions, what
will the tanker operators probably do?

Level 1 answers that, per player. A **player** is an actor card on your board: a person, an
organisation. For each player you (or the board) give a short, closed list of moves they could
make next. The engine picks the move it finds most likely, says how confident it is, and names
the cards it looked at.

You see it next to the player as a plain sentence:

> local-rules estimates 0.58 for Keep night transit restrictions

Always with the engine's name. Never "the answer is". The number is the engine's own estimate.
It is not a probability measured against reality, and it is not a source's judgement
([ICD 203 words](../adr/0010-estimative-probability-scale.md) are for sources, not for engines).

## Where the guess comes from

Only from what is on your board: the actor cards (their interests, capabilities, dependencies,
past moves, red lines and assumed goals), the evidence cards you placed, and your own rule cards.
Nothing from the internet, nothing from other boards.

The default engine, **local rules**, runs on your machine and needs no network. It works like a
careful clerk, not like a clairvoyant:

- **What they did counts more than what they said.** A move the player has made before weighs
  more than an interest or a goal on their card. When what a player says and what they do point
  in different directions, the engine follows the behaviour and tells you they diverge.
- **Red lines remove options.** If a move would cross a red line recorded on the card, the engine
  drops it. If it only looks a little like one, it just counts against the move.
- **Dependencies make drastic moves less likely.** Stopping or cutting something the player
  depends on is penalised.
- **Your rules are read as your expectations.** If one of your rules fires and its action is one
  of the options, that option gets a push, and the rule card is listed among the cards used.
- **It admits when it does not know.** With no evidence it picks the first option at "one in n"
  confidence. With only one kind of evidence the confidence is pulled towards "one in n". It never
  claims more than 0.95.

The comparison of words is simple on purpose: it matches the important words of short phrases and
does not understand negation or meaning. That is why every estimate can show a breakdown of what
counted for and against each option, and why you can check it.

## What if I change an assumption?

When you place, remove or edit an assumption card, the board asks again. A local engine answers at
once. An estimate is shown only while it still describes the board as it is now. After a change
the old estimate is marked stale until the new one arrives, and a late answer to an old question
is thrown away.

A **cloud engine** never re-runs by itself. Each change would send your cards to someone else, so
it needs a new preview and your confirmation every time.

## Cloud engines

Some services offer a fast "System One" decision for a typed question. Jev is one example, and
there are others. They plug into the same socket as the local engine. They only ever receive cards
that the [disclosure gate](../adr/0012-disclosure-gate.md) released after you confirmed that
transfer, nothing else. The wire format of the real Jev service is not confirmed yet; the adapter
in the repository is a template that other providers can use too.

## From a guess to a board

Any estimate can be escalated: the board opens a new analysis whose question asks for that
player's next move, whose options are the move options, with the cards the engine used already
placed. Nothing of the estimate is copied over as a fact. Thinking starts there.

## What an estimate is not

- It is not a card, a decision or a rule result, and it feeds no statistic.
- It is never shared with other people. It is a conclusion of yours
  ([ADR-0036](../adr/0036-conclusions-are-private.md)).
- It does not write to your world. If an engine thinks the world should change, it can only
  propose, and you decide ([ADR-0011](../adr/0011-agent-moves-are-proposals.md)).

See the [reference](../reference/adapters.md#level-1-engines) for the interfaces and
[ADR-0035](../adr/0035-level1-engine-socket.md) for the decision.
