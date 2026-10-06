---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0019: Design tokens only until the brand design system lands; canvas on @xyflow/react

## Context and Problem Statement

The owner commissions a dedicated design system derived from the logo and
explainer film (navy, cream, gold; chessboard and situation-map language,
not a generic dashboard). It is delivered separately and later. The board
needs a canvas for cards, seats and typed edges now. Concept v1 compared
React Flow and tldraw and chose React Flow; it also proposed its own layer
colours. How do we build UI today without blocking or reworking it later?

## Decision Drivers

- The design system must drop in without code changes in components.
- No default component-library look.
- The canvas renders our data model; our Lage format stays the truth.
- Permissive licence for the canvas library.

## Considered Options

Styling:

- Design tokens (CSS custom properties) only
- A component library with its theme (for example Material or Chakra)
- Hard-coded styles now, refactor later

Canvas:

- `@xyflow/react` (React Flow) with fully custom nodes
- tldraw
- Custom SVG or canvas rendering

## Decision Outcome

Chosen options: "Design tokens only" and "`@xyflow/react` with fully
custom nodes", because tokens let the brand system replace values in one
place, and React Flow renders typed nodes and edges from our own data.

- All colours, fonts, spacing and radii come from CSS custom properties
  (for example `apps/board/src/tokens.css`). Components never hard-code a
  colour or font.
- Brand defaults until the design system lands: navy `#0d1722`, cream
  `#f1ece2`, gold `#c9a44c` (gold = the user), evidenced teal `#4fb3a5`,
  said blue `#7fa3d6`, believed gold; fonts Fraunces and Inter, referenced
  only through tokens.
- No component-library default theme; headless primitives are allowed.
- Canvas: `@xyflow/react` (MIT) with custom node types for cards and
  seats and custom edge types per edge kind. The Lage format
  ([ADR-0023](0023-core-domain-model.md)) is persisted, never the
  library's internal state, so the canvas stays replaceable.

### Consequences

- Good, because the design system replaces token values, not components.
- Good, because the board looks like the product, not like a library.
- Bad, because early screens look plain.
- Bad, because free-hand sketching is weaker than in tldraw; a sketch
  view stays a later option.

### Confirmation

A lint or CI check rejects hex colours and font families outside token
files in `apps/board`. Accessibility check (axe) runs on the board from
M1. Reviewers check that persisted Lage data contains no library-specific
fields.

## Pros and Cons of the Options

### Tokens only

- Good, because the design system drops in.
- Bad, because more upfront discipline.

### Component library theme

- Good, because fast.
- Bad, because generic look and heavy theming later.

### Hard-coded styles

- Good, because fastest today.
- Bad, because full rework later.

### @xyflow/react

- Good, because typed graph, custom nodes, MIT licence.
- Bad, because weaker free drawing.

### tldraw

- Good, because excellent free drawing.
- Bad, because its own document store and a licence with conditions for
  production use.

### Custom rendering

- Good, because full control.
- Bad, because large effort for pan, zoom, selection, accessibility.

## More Information

- Supersedes concept v1: `docs/02-ux-board.md` §2.1 colour choices
  (evidenced neutral grey, believed "deep blue" ink, experience green or
  ochre). Kept from concept v1: `docs/04-architektur.md` §9 choice of
  React Flow and the rule that our own layout format is persisted.
- Related: [ADR-0003](0003-typescript-monorepo-stack.md),
  [ADR-0023](0023-core-domain-model.md).
