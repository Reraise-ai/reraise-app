---
status: accepted
date: 2026-10-14
decision-makers: "Owner (e-52, e-58, released 2026-10-14), builder (contract shape)"
---

# ADR-0051: A theme Lage carries 2-4 questions and one collector card

## Context and Problem Statement

The owner set that a playing field is a **theme** with several questions to play through
(Vitamin D with three questions), that each question has votes for and against, and that
each theme has exactly one collector card. A click on a source opens the card of that
person or organisation (e-52, e-58). The Hormuz Lage stays a single guiding question.
How is that stored?

## Decision Drivers

- A theme is 2-4 questions, not one question with options (owner, 2026-10-14).
- Votes are lists of card ids, not typed-in counts (independence is derived, AC-29).
- Exactly one collector card per theme (e-52).
- A single-question Lage (Hormuz) must keep working.

## Considered Options

- Replace `question` with a 2-4 list on every Lage
- Optional `questions` (2-4 items, each with `for` and `against` card ids) plus
  `collectorCardId`, required together (chosen)

## Decision Outcome

Chosen option: optional `questions` and `collectorCardId` on the Lage, because Hormuz
stays one `question` and a theme Lage is explicit.

- `questions` is 2 to 4 items. Each item is `{ text, for, against }`. `for` and `against`
  are unique card ids. The board shows "N for · M against" from those lists.
- `collectorCardId` is the one collector card of that theme. It is required when
  `questions` is present, and `questions` is required when it is present.
- `question` stays required: a theme Lage still has a guiding line (the theme).
- Clicking a source on a placed card opens a placed `person` or `organisation` card
  whose `source` or id is that value.

### Consequences

- Good, because a theme field matches the Vitamin D board and Hormuz is unchanged.
- Bad, because `question` and `questions[0].text` can drift; the board shows both.

### Confirmation

Schema fixtures for a three-question theme, five questions, a theme without a collector
and a collector without questions. A board test lists the questions with vote counts
and opens the collector card.

## Pros and Cons of the Options

### Replace `question`

- Good, because one list.
- Bad, because every existing Lage and the walking skeleton would be invalid.

### Optional `questions` plus collector

- Good, because it is additive.
- Bad, because two fields must stay in step.
