# Why layers never merge

Every card in The Worldbuilder carries an epistemic **layer**: `evidenced`, `said` or
`experience`. A fourth thing, "believed", exists too, but it is not a layer. This page
explains the reasoning, because it shapes the model, the board and the rules.

## The problem

When material arrives from many places, three different kinds of statement blur into one
sentence in the reader's head:

- "The harbour authority's statistics show 12 % fewer tankers." Something you can trace to
  an original.
- "An analyst claims the strait will be closed." Someone said it. You can verify that they
  said it, not that it is true.
- "I think this market is excellent." A conclusion you hold, perhaps for good reasons.

In a normal note app all three look the same. After a few weeks "an analyst claims Y"
becomes "Y is true", and the origin of your confidence is gone. The Worldbuilder exists to
stop that slide.

## The three layers

| Layer | Question it answers | What it requires |
| --- | --- | --- |
| `evidenced` | Can this be traced to a source or an original? | a `source` or `originSystem` |
| `said` | Did someone claim this? | a `source` or `originSystem` (who said it, where) |
| `experience` | Did the user live this? | an `author` (the experiencer) |

Experience is evidence of its own kind. "A thinker says method X works" is not the same as
"I applied method X five times and it worked four times". The second is no proof of a
universal truth, but it is valuable personal decision knowledge, and it deserves its own
layer rather than being squeezed into one of the others.

## Why "believed" is a stance, not a layer

Earlier concept work treated "believed" as a fourth layer next to the others. That turned out
to be a modelling error. Belief is not a property of a statement; it is the user's *position
on* a statement. The same statement can be "said by X" and at once "believed by me". A fourth
layer forces a choice that is not real.

So belief is a **stance**: an overlay stored per user per card, with `position` (`believed`,
`rejected`, `undecided`), a `weight`, a `note` and an update time, with history kept. Three
consequences follow.

1. A card keeps its true layer. Believing a said card does not turn it into evidence.
2. Stances are private. They never leave the device and are never sent to a model beyond
   the screen.
3. The card field name `level` stays free for future card tiers. The epistemic kind is
   `layer`.

When a legacy system stores `believed` as a layer, an adapter reads it as a said card
authored by the user plus a believed stance. The conformance kit tests that mapping rule.

## What "never merge" means in practice

- **No combined number.** No counter, meter or summary adds the layers together without a
  breakdown. Every figure can be unfolded into its layers by one click.
- **No verdict.** This is why the probability barometer was removed. A meter such as "hold
  69 : 31" weighted the layers with fixed factors into one figure. That is a merge, however
  honestly it is labelled, and it reads as the system's own judgement. The Rules panel shows
  which of *your* rules fired and which cards triggered them, and nothing else.
- **Proposals do not count.** What an agent proposed has no layer in the world until a human
  accepts it, and it never counts in rules or statistics before that.
- **Contradiction stays visible.** A world may contain contradictory cards. Nothing resolves
  them for you.
- **Context packages keep the split.** A model receives each card with its layer, speaker,
  provenance and (only if cleared) nothing of your stance, so it cannot blend the layers
  either.

## Trade-offs

Keeping layers apart costs convenience. A single score would be easier to read. The project
accepts that cost on purpose: the value of a personal knowledge layer is that you can see
why you believe what you believe. See also
[provenance and independence](./provenance-and-independence.md), which applies the same
discipline to counting.
