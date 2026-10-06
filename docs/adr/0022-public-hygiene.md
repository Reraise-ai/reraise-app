---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0022: Public hygiene: synthetic data only, no-real-data check, secret scanning

## Context and Problem Statement

This is the owner's first public project. The product is built to hold
highly sensitive personal data: a user's store can contain identity
documents, tax identifiers and bank statements. People and agents working
on the repository may see private material from the systems they work
with. A
single leak into the public history is permanent. How do we keep the
repository and its history clean?

## Decision Drivers

- Leaks into Git history are effectively irreversible once public.
- Humans and agents make mistakes; checks must be automatic.
- Examples and tests still need realistic data.

## Considered Options

- Manual review only
- Keep the repository private
- Automated checks plus synthetic-only data rules (chosen)

## Decision Outcome

Chosen option: "Automated checks plus synthetic-only data rules", because
review alone misses things, and a private repository contradicts the
owner's goal of a public project.

- Only synthetic data in the repository. Example worlds live in
  `examples/` (synthetic scenarios: geopolitics / Hormuz, a flat in
  Palma) and every example card has `synthetic: true` in its front matter.
- Never in the repository or its history: secrets, tokens, real personal
  data, real card contents, owner infrastructure details (server names,
  paths, IPs), names of the owner or of the owner's assistants and agents, customer
  names, or internal tooling names. The owner's store is referred to
  generically ("the owner's card store", "the owner store's write
  channel"). Hand-over material is never committed.
- `.gitignore` excludes local worlds (`worlds/`, `*.local.*`,
  `.worldbuilder/`) and `HANDOVER*`.
- CI "no real data" check: scans for IBAN patterns, German tax-ID
  patterns, passport-like numbers, e-mail addresses outside an allow-list,
  private IP ranges (loopback `127.0.0.1` / `localhost` is allow-listed),
  and data files under data directories without
  `synthetic: true`.
- Secret scanning in CI on every push and pull request, plus the hosting
  platform's secret scanning and push protection when available.
- If a leak happens: stop, rotate affected credentials, rewrite history
  before the repository is (or stays) public, and record the incident.

### Consequences

- Good, because mistakes are caught before merge.
- Good, because contributors know exactly what is allowed.
- Bad, because pattern checks produce false positives; the allow-list
  must be maintained.
- Bad, because examples must be invented carefully to stay realistic
  without resembling real people.

### Confirmation

The CI jobs above are required checks on the trunk. The pull request
template asks "no real personal data" as part of the Definition of Done.

## Pros and Cons of the Options

### Manual review only

- Good, because no tooling.
- Bad, because one oversight is permanent.

### Private repository

- Good, because limits exposure.
- Bad, because contradicts the public-project goal; leaks stay in history
  for a later publication.

### Automated checks and synthetic data

- Good, because systematic and early.
- Bad, because false positives and maintenance.

## More Information

- Supersedes concept v1: nothing; concept v1 already marked all scenario
  data as invented (`docs/02-ux-board.md` §11–§12).
- Related: [ADR-0004](0004-two-tier-licensing.md),
  [ADR-0012](0012-disclosure-gate.md).
