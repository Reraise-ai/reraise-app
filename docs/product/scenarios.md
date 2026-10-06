# Scenarios

Two worked scenarios walk through the [board UX](./board-ux.md) from question to review.
They are the basis for the synthetic example worlds in `examples/` (`hormuz` and `palma`).

::: danger Everything here is fictional
Every name, quote, date, figure, price and event on this page is **invented** for
illustration. Nothing describes a real event, person or property. None of it is a forecast,
investment advice or purchase advice. Any resemblance to real people or listings is
accidental. Example worlds in the repository carry `synthetic: true` in their front matter,
and a CI check refuses data files that do not.
:::

The ADRs in the [ADR log](../adr/README.md) are normative. Where a step below shows something the
contracts do not cover yet (a forecast and review date on a decision, the foreign-body tray, series counters such as "3 of 4"), it illustrates the intended slice and needs an ADR first
([ADR-0017](../adr/0017-decision-card-and-training-export.md),
[ADR-0024](../adr/0024-concept-v1-reconciliation.md)).

Status: the scenarios describe the intended experience across milestones. Milestone M1 covers
the Hormuz path from "open a Lage" to "context package and blocked private card" (see the
[roadmap](../roadmap.md)). Steps marked planned (M2+) are not built yet.

## Scenario A: Hormuz (geopolitics)

Today's date in the example: 5 October 2026. The user has a world "Geopolitics" with three
premises and the stance they hold on each (stances are private):

- P1 "Geopolitics beats markets" (believed, weight 0.7)
- P2 "States act on interests, not rhetoric" (believed, weight 0.8)
- P3 "Oil price shocks hit my portfolio within weeks" (believed, weight 0.55)

The user's portfolio in the example is also invented: 60 % broad index fund, 10 % energy
shares, 8 % gold, 22 % cash.

### 1. Ask

The user opens a new Lage and writes the guiding question:

> **Does the situation at the Strait of Hormuz escalate within the next three months, and
> what does that mean for my portfolio?**

A proposal suggests sharpening it: "what counts as escalation?" The user accepts a definition
to use as a resolution criterion later: *escalation means a military incident with damage or
casualties involving merchant ships in the strait, confirmed by at least two independent
origins, or a traffic interruption over 24 hours.* Horizon: 5 January 2027. Options are
entered: leave the portfolio unchanged, raise gold to 12 %, cut energy shares to 5 %.

Data: a `lage` card with `question`, `options[]`, empty `cards[]`.

### 2. Populate

The left sidebar proposes cards from the world, ranked by relevance to the question: the
actors (a regional power, two great powers, two neighbouring states), an experience card
("an earlier oil shock: hedging helped", 3 of 4), and a rule ("do not act on the first day
of an escalation headline").

The **inbox** shows two *new findings from connected sources*: a note in the user's own
vault summarising an invented podcast episode, and a news-service item. Neither is ingested ([ADR-0014](../adr/0014-no-ingestion-inbox-of-findings.md)).
Each is shown by reference with provenance and its source pass: **"4 findings · 1 origin"**
for the news item, because four reports trace back to one invented wire-service text. The
user pins the vault note, which places a reference to it in the Lage, and dismisses one
duplicate.

An agent seated at the board (`agent:scout`) **proposes** two cards and one `supports` edge.
They appear dashed with the agent's name. The user accepts one card and rejects the other
proposal ([ADR-0011](../adr/0011-agent-moves-are-proposals.md)). Only the accepted card exists in
the world, and the accepted card keeps `author: agent:scout`.

### 3. Read (playing field)

The user fills in the seat cards. Each entry has a source; an entry without one is not
written:

| Seat | Interests | Capabilities | Dependencies |
| --- | --- | --- | --- |
| Regional power | sanctions relief, oil exports, regional influence | sea mines, missiles, fast boats | export revenue through the strait, one main buyer |
| Great power 1 | free sea lanes, low oil price, protecting allies | naval presence, sanctions | few oil imports, allies depend on it |
| Great power 2 | energy supply, markets, influence | trade, veto | oil from the region (high) |
| Neighbour A | deterrence | air force, intelligence | support from great power 1 |
| Neighbour B | oil price, security of exports | production capacity, pipelines | part of its exports use the strait |

Edges are drawn: an alliance, a conflict, and two `depends_on` edges.

**Statement versus action.** On the timeline, the regional power's spokesperson said on
12 September "no interest in closing the strait" (layer: said, original text kept). On 20 September a naval
exercise with mine-laying practice took place, evidenced by an invented institute's
satellite analysis (layer: evidenced, page 3). The user draws a `refutes` edge between them,
marked with a lightning symbol. They set a stance on the statement: rejected, weight 0.6,
note "the exercise speaks against it, but an exercise is also deterrence". The stance is
private.

### 4. Check (Rules panel)

Instead of a gauge, the **Rules panel** ([ADR-0013](../adr/0013-rules-panel-replaces-barometer.md)) lists the user's own rules for this Lage:

- `fired` R7 "do not act on the first day of an escalation headline", triggered by the
  headline card.
- `not fired` R3 "hedge only if exposure exceeds the stated limit": no card states the
  current exposure.

The evidence wall for P2 shows supporting cards (the contradiction above, one experience
card) and weakening cards (one said card by an analyst) with raw counts per layer and origin
stacks. There is no overall score. An agent-proposed hypothesis that was not accepted
appears dashed and counts nowhere.

A card that does not fit, an invented "port strike" item, would sit in the foreign-body tray and
stay visible (a planned UX element, pending an ADR).

### 5. Decide

Level 1 ([ADR-0015](../adr/0015-two-thinking-levels.md)): the user asks the local rules engine. It answers **"local rules engine estimates
0.7 for option B"**, with its input cards listed, and the board marks it as an estimate, not
a verdict. The user escalates and works the decision on the board.

The decision card, with all eleven sections:

| Section | Example content |
| --- | --- |
| situation | tension at the strait, portfolio 22 % cash |
| trigger | the exercise and the escalation headline |
| conditions | staged execution in two steps |
| facts | the exercise card, the statement card, the earlier-shock experience card |
| priorities | loss limitation before return |
| action | raise gold from 8 % to 12 % from cash, in two steps |
| alternatives | leave unchanged; cut energy shares |
| exclusions | no reallocation if gold is already 15 % above its yearly average |
| rationale | hedge against a tail risk, consistent with R7 |
| cardsUsed | ids of the cards above (all must exist) |
| outcome | `open` |

The user records their own forecast with the verbal probability "unlikely" (original phrase kept, mapped band
20–45 %, [ADR-0010](../adr/0010-estimative-probability-scale.md)) that escalation occurs by 5 January 2027, and a review date. A snapshot of the board
as of the decision is archived.

Before a context package of this Lage goes to a cloud model, the **disclosure gate**
([ADR-0012](../adr/0012-disclosure-gate.md)) denies the portfolio card, and the board lists exactly which cards
would leave the device. The user's stances are never in the package at all. The user declines the transfer and uses a local model instead.

### 6. Follow up (5 January 2027, invented outcome)

The user records: "threats and two incidents without damage, no interruption over 24
hours." The forecast resolves as **did not come true**. The decision is rated "mixed" (a separate rating of process and outcome is a deferred feature): a hedge
against something that did not happen, sound in process. The user writes one lesson: weigh
probability words from sources with a commercial interest lower. The system proposes an
experience card, a rule statistic update and a source-profile update, and the user accepts
them. The loop is closed and the world is a little more experienced.

## Scenario B: Palma flat

Today's date in the example: 5 October 2026. A world "Property, region R" holds two
premises: P1 "Substance and building costs beat location hype" and P2 "I hold for at least
ten years" (an assumption). It also holds experience cards, contacts and one rule:

- Experience (series): "bought without checking the owners' meeting minutes", an earlier
  purchase elsewhere, outcome: special levy of 12,000 (bad), 1 of 1 negative.
- Experience (series): "price negotiation with agents", 4 attempts, 2 with a 4–6 % discount.
- Contacts as actors: an estate agent with a double role and a commission interest, a
  lawyer, an acquaintance who lives nearby.
- Rule R1: *"Buy only below 4,000 per m² in areas with year-round rental demand and without a
  decided or foreseeable renovation levy, unless the levy is deducted from the price."*

### 1. Ask

> **Do I buy flat X in Palma for 480,000?**

Horizon: the offer deadline of 30 November 2026.

### 2. Populate

The sidebar proposes the earlier purchase experience, R1 (gear mark: "applies to price per
square metre") and the three contacts. The user pins them. Connected sources report new
findings by reference: the agent's brochure (a PDF in the user's own document system), a
voice note the user took after the viewing, and a land-registry extract. They are pinned
with their provenance, not ingested:

| Statement | Layer after pinning | Note |
| --- | --- | --- |
| "125 m², built 1974" (brochure) | said (speaker: agent) | seller-side document, not evidence |
| "480,000 asking price" | said (agent) | an offer, not checkable |
| "no mortgage registered" (registry extract) | **evidenced** (extract, page 2) | official register |
| "prices rise about 8 % a year" | said (agent), commission interest | forecast candidate |
| "the facade will be repaired anyway" (voice note) | said (acquaintance) | hearsay about a third party |
| "stairwell is damp" (voice note) | experience-type observation by me | own observation without evidence; with a photo it would be evidenced |

The "8 %" statement is marked as a forecast (author: the agent, resolution 30 November 2028)
and the user sets a stance: rejected, weight 0.7, note "agent has a commission interest".
Provenance shows the facade statement as a chain acquaintance → neighbour: **1 origin**,
unverifiable.

### 3. Read

Seats: buyer (me), seller, estate agent, owners' community, municipality. Entries with
sources: the seller wants the highest price; the agent wants the commission and steers the
seller; the community wants to preserve the building and can decide levies. On the timeline:
viewing 2 October, owners' meeting 14 November (pending), offer deadline 30 November. A
contradiction appears: the agent says orally "the community is healthy", the brochure says
"facade renovation planned" without an amount. Both are said, so a scales mark appears and
no lightning, since no action is involved.

### 4. Check

The **Rules panel** evaluates R1 against the cards. 480,000 divided by 125 m² is 3,840 per
m², below the limit, so that condition holds. There is no card on year-round rental demand,
and the facade renovation is hearsay. Result:

- `not fired` R1: condition 1 holds (card: price per m²); condition 2 has no triggering card;
  condition 3 is likely violated (card: facade statement, unverified).

No percentage is shown. The user asks an agent seat for the strongest counter-argument to
buying; it proposes the earlier-purchase experience. A "what is missing?" proposal lists:
no evidenced card on decided levies, request the last three owners' minutes, no opposing
voice on the agent's price claim.

### 5. Decide

Options: A buy at 480,000; B negotiate (target 450,000, ceiling 455,000) with the minutes as a condition; C do not
buy. The user chooses B. Conditions: the minutes of the last three meetings before the
offer, the facade levy amount clarified. Exclusion: a decided or quantified levy over 15,000
without a price deduction. Rationale links the earlier experience, the R1 check and the
registry extract. Two forecasts are recorded with review dates (30 November 2026 and 30
November 2028), and a snapshot is archived.

### 6. Follow up (30 November 2026, invented outcome)

The seller refuses 455,000 and offers 468,000 if the minutes are provided. The minutes show
an 11,000 facade levy decided and not in the price. The exclusion does not trigger (below
15,000) but R1's levy condition is violated. The first forecast resolves as did not come
true; the user opens a follow-up Lage with a new decision card.

### Outlook: exchange with a second user (not in scope for this repository's M0–M2)

A second user could share an experience card about a levy in the same building: signed,
with its own evidence, with their stance kept private. On import the system would notice an
identical content hash for the registry extract and count it as **one** origin, while the
second user's experience is an origin of its own. Stances never travel. This describes the
later platform, which is out of scope here. See the [vision](./vision.md).
