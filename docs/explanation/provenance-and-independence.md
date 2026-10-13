# Provenance and independence

Provenance is mandatory in The Worldbuilder. Every card says where it comes from, and the
system counts **origins**, not copies. This page explains why.

## Many copies are not many confirmations

Ten thousand people repeating one agency report are not ten thousand independent
confirmations. A typical chain looks like this:

1. Source A is the original report.
2. B cites A.
3. Analyst C cites B.
4. Media report D is based on C.

Four cards exist, but there is possibly only **one independent origin of information**. If
the board showed "4 supporting cards", it would invite exactly the wrong conclusion. The
useful question is: how independent is this information from each other?

## What the model records

- Each card has a `source`, a `sourceDate` and an `originSystem` where relevant. An
  evidenced or said card without a source or origin system is rejected
  ([ADR-0009](../adr/0009-mandatory-provenance.md)).
- Edges of kind `cites` and `based_on` record the chain between cards. Edges also record who
  drew them (`by`: `human` or `agent:<name>`).
- A card that comes from another system is referenced by URI and keeps its original
  provenance. Pinning a finding from a connected source does not rewrite its origin.
- A `contentHash` (SHA-256 of the canonical card content) and a `sourceChecksum` (SHA-256 of the
  original source document) let identical contents or sources be recognised as the same.
  The same `contentHash` or the same source URI means the same origin root.

## Origin roots and the counter

Follow `cites` and `based_on` edges back from a card until you reach a card that cites
nothing further. That card is an **origin root**. Cards that share a root form an **origin
stack**. The board's counter reads "N findings · M origins", where N is the number of cards
and M the number of distinct roots. In the example above it reads "4 findings · 1 origin".

Rules that follow from this:

- Counters show origins, never raw card counts.
- A stack counts once wherever origins are counted.
- An unknown origin counts as its own origin root and is flagged, so missing chain information
  never makes two cards look like one origin or like independent confirmation.
- A chain that cannot be followed (hearsay with no recoverable origin) counts as its own
  origin root and is flagged as such. One speaker quoted by many media is one root.
- The count is derived from the edges at read time. It is never typed in.

::: info Status
The counter is shipped. `originRoots` and `independenceOf` in `packages/core` derive each
card's origin root. The context package stores the count for the whole package in
`independence`. On the board each layer line reads "N findings · M origins" from those
roots, and there is no single summed total (AC-01). A view that draws the chain itself is
still planned.
:::

## Why this is not a credibility score

Provenance answers *where did this come from and how many separate roots are there*. It does
not say how trustworthy a root is. Trust in a source is the job of the **source profile**:
hit accuracy, reliability, topic competence per topic, agreement with your stances, deviation
from them, source quality, historical performance and counter-perspective value, each with a
sample size. The profile is multi-dimensional on purpose, because one score would hide that a
source can be accurate but ideologically distant, or often wrong yet valuable as a
counter-perspective. Sample sizes keep small numbers honest: a dimension below a minimum
sample size shows "insufficient data" ([ADR-0018](../adr/0018-multidimensional-source-profile.md)).

## Independence across people

If worlds are ever shared, the same discipline applies across people: identical content hashes
count as one origin, and a second person's own experience is an origin of its own. Only
content, provenance and public descriptive fields would travel. Stances and conclusions stay
on the device. The sharing platform is out of scope for this repository, but the model keeps
unique ids, a content hash and a reserved `signature` field so nothing needs to be redone later.

## Related

[Why layers never merge](./layers-never-merge.md) ·
[Card format: edges and provenance rules](../reference/card-format.md) ·
[Glossary](../glossary.md)
