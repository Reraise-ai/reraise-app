# Board experience: one core, several tables

Status: design contract, adopted 2026-10-29. Binding for every board view from M3 on.
Design studies: [`prototype/schools/`](../../prototype/schools/index.html) (five clickable
boards, same cards, same functions, five schools of interface design).

## The problem this solves

The board mechanics work: cards with a layer (proven, said, experience), moves that can be
taken back, rules instead of a verdict, agents at the table, a time slider. The way the board
*looked and felt* did not. The first design (October 2026) was a fireside room with a
chessboard. It became a dark dashboard grid with a tour overlay, and the things that make
Reraise a place rather than a tool (trading cards, pinging a knowledge card, membership,
community, the model mirror) ended up as links in a footer. Nobody finds a footer.

So on 2026-10-29 the same board was built five times, each time in the logic of one school of
interface design, with identical cards and an identical list of functions. The owner compared
them side by side. The findings below are what the comparison showed, and the contract is
what follows from it.

## Findings from the five studies

| School | What it taught us |
| --- | --- |
| Bauhaus / Rams (grid, typography, one accent colour) | Calm and legible. Layers can be told apart by type alone, not colour. Side functions as a register column are found, but feel like a form. |
| Fireside room (object metaphor: felt, walnut, playing cards, armchairs) | The only study where every side function was found at once, because each one is an *object with a place in the room*: a trading counter, a card index, a wallet, doors to other tables. |
| Direct manipulation (infinite canvas, tools on the object) | The best card interaction: grab a card and the tools appear on it; drag from edge to edge to connect. But fields were out of view until you zoomed out, and side functions hidden behind a minimap. |
| Usability heuristics (task flows, three detail levels, labels everywhere) | Safest for a newcomer, least loved. Its first-contact rule (one hint on the first object of each kind, then never again) is worth keeping; its look is not. |
| Tabletop (hand, deck, slots, rounds) | The empty table on arrival and throwing a card from the hand onto a glowing slot was the interaction the owner understood fastest. The full table was hard to reach from the first-hand state. |

Two conclusions:

1. **Look and play are two different things.** Three of the five differ only in surface
   (colours, type, texture). Two differ in *how you move* (a canvas you pan; a table with a
   hand and slots). A look is cheap and can be a user setting. A way of playing is a view of
   its own and costs real code.
2. **A side function is found only when it has a place.** Not a label in a bar, not a footer
   link. An object, in the same place, in every view.

## The contract

### 1. One core

Cards, edges, layers, stances, moves, rules, time, players and proposals live in the core and
the Board API. A view never owns state. Every view reads the same state and sends the same
operations. The Board API does not change for this work.

### 2. Two ways of playing ("tables"), a third later

| Table | Interaction | Default look | Where it fits |
| --- | --- | --- | --- |
| **Table** | Arrive at an empty table with a hand of cards. Lay a card by dragging it from the hand onto a slot; the slot lights up when the layer fits. Connections come from neighbourhood (supports row, refutes row, zones); "connect" is on the card for the rest. Players sit at the table with a turn marker; role play counts rounds. | Fireside room | Desktop, tablet |
| **Sheet** | Cards in columns and rows by relation and layer. Tools on the card. No drag needed. | Bauhaus | Narrow hosts: phone, the Hermes sidebar, embedding in a chat |
| Canvas (later) | Infinite surface, pan and zoom, draw a line to connect. | own | After Table and Sheet pass with first users |

Every table must offer the complete action list (section 4). A table that cannot is not merged.

### 3. Looks are user settings

A look is a token set only (colour, type, texture, radius, shadow): no code, no new tests.
Shipped looks: **Fireside room**, **Bauhaus**, **Slate table**. A host can add its own: the
Hermes desktop plugin maps the app's colours onto the board's tokens (`--wb-*: var(--ui-*)`)
and so adds a fourth look, "Hermes", automatically. The look follows the user across the
online board, the downloaded toolkit and the plugin.

### 4. The action list every table must offer

1. Open a card: source, layer, author, connections, *take* (copy into your own deck).
2. Lay a card of your own: text, layer, source. A proven card without a source is refused.
3. Connect two cards: supports, refutes, depends on, masks.
4. Move log with *take back*; time slider; "which of your rules apply" (applies / does not
   apply / unclear, never a percentage).
5. My stance (★): private, set only by the human, never on the card itself.
6. Fireside: address an agent, read its answer, pick a suggested question.
7. The side functions, each as an object with a fixed place in the view ("around the room"):
   - **Trade** a card with another member (offer, take; the origin stays with the author).
   - **Ping** a knowledge card from your own or the shared knowledge and bring it to the table.
   - **Membership**: your number, your standing (cards with a source, takes, origin points).
   - **Community**: other tables, the shared wiki of traded cards.
   - **Model mirror**: what five models say over the same cards, on its own clearly labelled
     layer, never a verdict of the board.
8. Role play: agents play the actors; rounds are counted.
9. **New field**: choose a base, draw zones, set seats and who moves (human, agent, model).

### 5. First contact

No tour overlay. The first object of each kind (card, slot, rule, fireside) carries one short
hint the first time it is touched, then never again. A newcomer must understand the first
screen without reading anything else.

### 6. What the board never does

No verdict, no meter, no percentage, no highlighted winner. "You decide what's true." The
layers separate *where a statement comes from*, not whether it is true.

### 7. One test for all

The same end-to-end script runs against every table: open a field, open a card, lay a card,
connect two cards, take a move back, move the time slider, set a stance, open trade, ping,
membership, community and the model mirror, create a new field; on 1440 px and on 390 px, in
light and in dark; no console error, no sideways scroll. A table is "done" when that script
is green in CI, not when it looks finished.

## Where the board appears

| Place | Table | Look |
| --- | --- | --- |
| reraise.ai/board (demo) | Table | Fireside room by default, switchable |
| Downloaded toolkit (`reraise serve`) | Table, Sheet on narrow screens | user setting |
| Hermes desktop plugin, board page | Sheet (sidebar width), Table in a wide pane | Hermes |
| Hermes chat, card directive | one card, rendered in the active look | Hermes |
| Other agents over MCP | no view; they act on the core | — |

## Out of scope here

Trading, membership, community and the model mirror are *shown* by every table as objects
with a place; the platform behind trading and membership stays a separate service and is not
part of this repository (see the roadmap).
