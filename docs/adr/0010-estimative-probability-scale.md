---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0010: Probability words use the ICD 203 scale; store phrase and band

## Context and Problem Statement

Sources rarely state numbers; they say "very likely" or "possible". Hit
statistics and source profiles need comparable values, but the board must
not pretend precision the source never gave. Concept v1 used its own
German word table with point values. Which scale do we use, and what do we
store?

## Decision Drivers

- A published, citable scale instead of an invented one.
- Keep the source's original wording.
- Show words, not percentages, in the UI.
- Numbers only where statistics need them, always with sample size.

## Considered Options

- Own word table with point probabilities (concept v1)
- Sherman Kent's words of estimative probability (1964)
- ICD 203 (US Intelligence Community Directive 203) seven-band scale
- Numbers only; ignore words

## Decision Outcome

Chosen option: "ICD 203 seven-band scale", because it is published,
widely used in analysis, uses bands rather than false point precision, and
covers the full range.

| Band key | Phrase | Range |
| --- | --- | --- |
| `almost_no_chance` | almost no chance | 1–5 % |
| `very_unlikely` | very unlikely | 5–20 % |
| `unlikely` | unlikely | 20–45 % |
| `roughly_even` | roughly even chance | 45–55 % |
| `likely` | likely | 55–80 % |
| `very_likely` | very likely | 80–95 % |
| `almost_certain` | almost certain | 95–99 % |

- Stored per estimate: the original `phrase` verbatim (any language), the
  mapped `band`, and an explicit number only if the source stated one.
  The exact field names are fixed in the JSON Schema.
- A mapping of a phrase to a band is made by a human or by a deterministic
  lookup table; a mapping suggested by an agent is a proposal
  ([ADR-0011](0011-agent-moves-are-proposals.md)).
- Phrase-to-band lookup tables for other languages (for example German)
  live with the i18n resources, not in the canon.
- The UI shows words. Numeric values are used only inside statistics
  (hit accuracy, calibration) and are always shown with sample size; the
  scoring formula is fixed in the source-profile slice.

### Consequences

- Good, because estimates are comparable without losing the source's words.
- Good, because the scale is citable in docs and to users.
- Bad, because some phrases ("possible", "could") have no clean band;
  they stay unmapped until a human maps them.
- Bad, because ICD 203 omits the 0 % and 100 % ends; certainties are not
  estimates and are not mapped.

### Confirmation

Schema tests (valid band keys, phrase required, invalid band rejected);
unit tests for the default English lookup table in `packages/core`.

## Pros and Cons of the Options

### Own word table

- Good, because tuned to German usage.
- Bad, because not citable, point values overstate precision.

### Kent scale

- Good, because historic reference.
- Bad, because gaps between categories and fewer bands.

### ICD 203

- Good, because current, published, banded, complete.
- Bad, because English-centred; translations need tables.

### Numbers only

- Good, because simple statistics.
- Bad, because most sources give words; data would be lost.

## More Information

- Supersedes concept v1: `docs/03-datenmodell.md` §11.1 word table
  (sicher 0.95 … ausgeschlossen 0.03) and `probabilityBasis`.
- Related: [ADR-0015](0015-two-thinking-levels.md) (level-1 engine
  confidence is a different thing: an attributed engine output),
  [ADR-0018](0018-multidimensional-source-profile.md).
