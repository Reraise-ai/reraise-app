---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0027: Card format mapping addenda: Lage heading and archive folder

## Context and Problem Statement

[ADR-0023](0023-core-domain-model.md) maps every field of the owner's card format v2 to the
canonical model, but two German identifiers in the format are not covered by its tables: the
heading of the Lage position section (`## Stellung`) and the name of the archive folder
(`_archiv`). [ADR-0006](0006-files-are-the-truth.md) already names the archive `_archive`.
The reference format and the conformance kit need one stated mapping so that an adapter
round-trips both identifiers.

## Decision Drivers

- Lossless round-trip with the owner's store ([ADR-0023](0023-core-domain-model.md)).
- English identifiers in the universal reference format ([ADR-0002](0002-english-repository-language.md)).
- No change to the files of an existing store.

## Considered Options

- Keep the German identifiers in the reference format
- Use English identifiers in the reference format and map the store's names in the adapter (chosen)

## Decision Outcome

Chosen option: "English identifiers, mapped in the adapter", because the reference format is
universal and the owner's adapter already translates every other German identifier.

| Card format v2 (store) | Canonical / reference format |
| --- | --- |
| Lage body section `## Stellung` containing the JSON block | `## Position` containing the same JSON block |
| archive folder `_archiv/<file>.v<n>.md` next to the card | `_archive/<file>.v<n>.md` next to the card |

- An adapter reads and writes the identifier its own store uses and exposes the canonical one.
  The reference `markdown-files` adapter writes the English identifiers.
- The JSON keys inside the block follow [ADR-0023](0023-core-domain-model.md) (Lage table).
- Validators ignore the archive folder under either name.

### Consequences

- Good, because the reference format has no German identifiers and the mapping is testable.
- Bad, because an adapter for a German store must implement two more renames.

### Confirmation

Conformance tests: a store Lage with `## Stellung`, read by the adapter, yields the
canonical Lage and is written back unchanged except for patched fields; the previous version of
a rewritten Lage appears under the store's own archive folder name.

## Pros and Cons of the Options

### Keep the German identifiers

- Good, because zero mapping.
- Bad, because German identifiers in a universal format.

### English identifiers, mapped in the adapter

- Good, because universal and consistent with the other fields.
- Bad, because two more mapping rules.

## More Information

- Supersedes concept v1: nothing.
- Related: [ADR-0006](0006-files-are-the-truth.md), [ADR-0023](0023-core-domain-model.md).
