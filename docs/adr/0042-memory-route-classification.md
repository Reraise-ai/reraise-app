---
status: accepted
date: 2026-10-06
decision-makers: "Owner (product), CTO/orchestrator (technical)"
---

# ADR-0042: `memory_route` classifies agent memories with ordered deterministic rules

## Context and Problem Statement

In the measured installation of [ADR-0039](0039-knowledge-loop-receipts.md), a nightly memory
job wrote 30 to 40 "learnings" a day into a separate memory database, while the card store got
none. Some of those items are durable knowledge that belongs on a card; most are operational
facts (a port, a restart, a failed run) that should stay in the agent system's own memory. The
memory job needs one call that says which is which, the same way every time. How is an item
classified?

## Decision Drivers

- Deterministic: the same item yields the same route, testable with a fixed corpus.
- Fail safe: a secret or a machine detail must never become a card proposal.
- Keep the human's proposal queue short: 30 to 40 proposals a night would bury the board.
- No content stored or logged; the item is inbound data, not a card.
- A model may help later, but the rules decide first.

## Considered Options

- Ask a model for every item
- Send every learning as a card proposal and let the human sort
- Ordered deterministic rules over the text and an optional kind hint; model only later and only
  for what the rules leave at the default (chosen)

## Decision Outcome

Chosen option: "ordered deterministic rules", because they are fast, free, explainable by rule
id, and testable with a corpus.

### Contract

- Request (`schemas/memory-route.schema.json#/$defs/request`): `text` (1 to 4000 characters),
  optional `kindHint` (`learning`, `observation`, `preference`, `decision`, `ops`, `unknown`),
  optional `source` (card id or URI).
- Result (`MemoryRouteResult`): `route` (`card_proposal` or `ephemeral_ops_fact`), `ruleId`,
  `signals` (signal ids, never the matched words) and `classifier` (`rules:v4`).
- `memory_route` stores nothing and creates nothing. For `card_proposal` the caller writes the
  card itself through `knowledge_write_back`; for `ephemeral_ops_fact` it keeps the item where
  it is and, inside a task, may answer the write-back with reason `ephemeral_ops_fact`.

### Signals

The text is lower-cased and whitespace is collapsed before matching (word boundaries).

| Signal | Detected by |
| --- | --- |
| `secret_like` | **Credential words** (`password(s)`, `passwd`, `passphrase(s)`, `secret(s)`, `secret key`, `token(s)`, `api key(s)`, `apikey`, `bearer`, `credential(s)`, `private key`, `ssh key`, `pin`, `otp`) followed in the same clause (up to 40 characters, no `.`, `;`, `!`, `?`) by `:`, `=` or a quoted value; or by `is`, `are`, `was`, except for bare `pin` and `token(s)`, which are too common in prose for that form. **On the raw text:** a private key block; a known credential prefix at the start of a token (`xoxa-`, `xoxb-`, `xoxp-`, `xoxr-`, `xoxs-`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `sk-`, `sk_live_`, `pk_live_`, `npm_`, `AKIA`, `ASIA`, `AIza`, `glpat-`, each with a token-length tail); a Slack-style webhook (`hooks.slack.com/services/…` or `/workflows/…`); a JSON Web Token; a URL with a password (`scheme://user:password@`); 32 or more hex digits. **Per segment**, after removing canonical UUIDs (8-4-4-4-12 hex), `wb:<uuid>/<id>` URIs and ISO dates (also joined, as in `2026-10-01/2026-10-08`), and splitting URLs and paths on `/ ? & = #` (other words stay whole, since a base64 key may contain `/`): a run of 32 or more base64/base64url characters that is not a slug of short hyphen- or underscore-joined parts and holds upper-case and lower-case letters and digits, or at least 8 digits whatever the case, or 40 letters and digits without a separator including a digit; also (`rules:v4`) a hyphen- or underscore-joined token with at least 8 digits overall and at least two parts mixing letters and digits (with only two parts, both must mix); and, on the raw text, a UUID within four words after a credential word, `key`, `Passwort`, `Kennwort` or `Schlüssel`/`Schluessel` (also as the end of a compound such as `Zugangsschlüssel` or `apitoken`, across a full stop, but not inside a `wb:` URI) |
| `personal_data` | an e-mail address (any domain), an IBAN (country length and mod-97) or a phone number (`+` and 8 to 15 digits, or 7 to 15 digits after a phone keyword). The patterns live in `packages/core` (`personalDataKinds`) and are shared with the repository's "no real data" check ([ADR-0022](0022-public-hygiene.md)) |
| `public_source` | an `http(s)` address in the text or in `source` that is a public address (`isPublicSourceUri`, [ADR-0036](0036-conclusions-are-private.md)) |
| `local_reference` | an absolute or home-relative file path, `localhost`, an IP literal, a `host:port` or `:port` pattern, or `pid <n>` |
| `transient` | words bound to a moment or an operation: `today`, `tonight`, `yesterday`, `this morning`, `right now`, `currently`, `for now`, `this session`, `temporarily`, `until restart`, `last run`, `retry`, `retried`, `restart`, `restarted`, `reboot`, `rebooted`, `timeout`, `timed out`, `out of memory`, `disk full`, `cron`, `deployed`, `rollback`, `build failed`, `exit code`, `stack trace`, `error code` |
| `durable` | words of lasting knowledge: `lesson`, `learned`, `learnt`, `insight`, `always`, `never`, `rule of thumb`, `principle`, `pattern`, `prefers`, `preference`, `decided`, `because`, `implies`, `in general`, `tends to`, `consistently` |
| `short` | fewer than three words |

### Rules, first match wins

| Order | `ruleId` | When | Route |
| --- | --- | --- | --- |
| 1 | `secret` | `secret_like` | `ephemeral_ops_fact` |
| 2 | `personal_data` | `personal_data` | `ephemeral_ops_fact` |
| 3 | `short` | `short` | `ephemeral_ops_fact` |
| 4 | `ops_hint` | `kindHint = ops` | `ephemeral_ops_fact` |
| 5 | `local_reference` | `local_reference` | `ephemeral_ops_fact` |
| 6 | `public_source` | `public_source` | `card_proposal` |
| 7 | `durable_statement` | `durable` and not `transient` | `card_proposal` |
| 8 | `transient` | `transient` | `ephemeral_ops_fact` |
| 9 | `knowledge_hint` | `kindHint ∈ {learning, preference, decision}` | `card_proposal` |
| 10 | `default` | otherwise | `ephemeral_ops_fact` |

- Secrets and personal data are checked before any rule that can lead to a card, and a machine
  detail (`local_reference`) wins over a public source in the same item: an item that mixes a
  public link with a private address is an operational fact.
- The default is `ephemeral_ops_fact`: an unclear item stays in the agent's memory rather than in
  the human's queue (an owner default, see [owner questions](../owner-questions.md)).
- The keyword lists are English. An installation may add words per signal (for example in
  another language) through the classifier options; the rule order cannot change.
- Version: the rules above are `rules:v4`. `rules:v1` had no `personal_data` signal, matched a
  credential only right before its separator, and checked `public_source` before
  `local_reference`. `rules:v2` fixed that but missed lower-case tokens and service tokens with
  known prefixes; `rules:v3` adds the digit rule, the prefixes and the raw-text webhook, JWT and password-URL checks, applies the run rules per segment so that dated URLs, UUIDs, `wb:` URIs and joined dates do not match, and keeps bare `pin` and `token` out of the "… is …" form. `rules:v4` adds two checks: a hyphen- or underscore-joined token with at least 8 digits overall and at least two parts that mix letters and digits (two parts: both must mix) is secret-like, also when it is shorter than 32 characters; and a canonical UUID within four words after a credential word, bare `key`, `Passwort`, `Kennwort` or `Schlüssel`/`Schluessel` (also as the end of a compound, and across a full stop) is secret-like, while a UUID in a `wb:` URI or elsewhere stays an identifier. The 40-character rule is unchanged: a long compound word with a digit is flagged too, on the safe side. Any change to signals, words or
  order is a new version with an ADR (this one records each version), so a corpus result is
  reproducible. Tests keep false-positive cases (hyphenated slugs, compound words, words that
  merely contain a prefix such as `task-` or `ski-`) next to the true positives.

### Model help (later)

A later slice may ask a `local_model` `ModelConnector` for items that end at rule 10; its result
then carries `classifier: model:<engine>`. A cloud model needs the per-transfer confirmation of
[ADR-0031](0031-gate-rules-and-confirmation-binding.md) like any other egress. The rules stay
first, so rules 1 to 5 can never be overruled.

### Consequences

- Good, because the memory job gets a stable, explainable answer per item.
- Good, because secrets, personal data and machine details are kept out of cards by the first
  rules.
- Bad, because keyword rules misclassify some items; the human still reviews every proposal, and
  the corpus grows with each found case.
- Bad, because English-only defaults need per-installation additions for other languages.

### Confirmation

`packages/knowledge-loop` tests: a synthetic corpus with at least one item per rule and the
expected route and rule id, including every case found in review (credentials with words before
the value, quoted passphrases, base64 keys with `/`, e-mail addresses, phone numbers, IBANs, a
private address next to a public link); secrets never route to `card_proposal`, also with a
durable word or a `learning` hint; `packages/core/src/personal-data.test.ts` for the shared
patterns; the result validates against the schema and never contains the input words;
added words change the signal only for their signal. Schema fixtures: a valid request and
result; invalid ones with an empty text, an unknown hint and an unknown route.

## Pros and Cons of the Options

### A model for every item

- Good, because it understands phrasing.
- Bad, because slow, costly, not reproducible, and memory items would leave the device for cloud
  models.

### Everything to the human

- Good, because nothing is lost.
- Bad, because 30 to 40 proposals a night bury the board and train the human to reject blindly.

### Ordered rules

- Good, because deterministic and explainable.
- Bad, because keyword lists need maintenance.

## More Information

- Supersedes concept v1: nothing (concept v1 had no agent memory routing).
- Related: [ADR-0011](0011-agent-moves-are-proposals.md),
  [ADR-0039](0039-knowledge-loop-receipts.md).
