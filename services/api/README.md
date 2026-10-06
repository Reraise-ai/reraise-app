# @worldbuilder/api

The Worldbuilder service: the Board API (Fastify) that implements
[`schemas/openapi/board-api.yaml`](../../schemas/openapi/board-api.yaml) and the
`worldbuilder` command. Licence: AGPL-3.0-or-later.

Design: [ADR-0016](../../docs/adr/0016-mcp-first-and-openapi-contracts.md) (OpenAPI first),
[ADR-0026](../../docs/adr/0026-security-defaults.md) (security defaults),
[ADR-0029](../../docs/adr/0029-process-topology.md) (one process, one write path),
[ADR-0030](../../docs/adr/0030-local-state-on-the-device.md) (local state),
[ADR-0031](../../docs/adr/0031-gate-rules-and-confirmation-binding.md) (gate rules, cloud
confirmation), [ADR-0032](../../docs/adr/0032-m1-proposal-polling.md) (polling).

## Run it

```sh
worldbuilder serve --store <path-to-store> [--state <dir>] [--port 4310] [--host 127.0.0.1] \
                   [--allow-origin http://127.0.0.1:5173]
worldbuilder agent add --name <name> --target local_model|cloud_model [--state <dir>]
worldbuilder agent list [--state <dir>]
worldbuilder agent remove --name <name> [--state <dir>]
```

`serve` opens the store with the markdown-files adapter (tested on a copy of the Hormuz
example, `src/hormuz.test.ts`) and binds `127.0.0.1` by default, creates a fresh human session token at every start, writes
it to `<state>/session-token` (owner-only) and prints it once. It refuses to start when the state
directory lies inside the store or a Git working tree (symbolic links followed) or when
`agents.json` is invalid or readable by others. On first start it writes a gate rule file that
allows cards on the screen only; without a rule the gate denies everything, also on the screen.
Binding another host prints a warning: put your own access control in front.

`agent add` registers one agent connection in `<state>/agents.json` and prints its bearer token
once; only the SHA-256 of the token is stored. The file is re-read when it changes. Hand-written
entries may carry a `token` (at least 32 characters) instead of `tokenSha256`; the file must be
mode 0600 on POSIX. Each connection has a target class: `local_model` or `cloud_model`.
`agent list` shows names and targets only; `agent remove` revokes a token at once. The whole
registry format lives in `src/agent-registry.ts`, so it can move to the planned
`agents.yaml` (ADR-0037) in one place.

`worldbuilder mcp --stdio` and the `/mcp` mount belong to the next slice. The seams are
documented in `src/app.ts` (the hook that already checks Host and Origin for every path) and
`src/main.ts`; the MCP tools call `handlers` from `src/operations.ts`, so both front ends end in
the same code.

## Request path

Host and Origin check, then the credential (exactly one of the session header or an agent bearer
token), then the access rule of the operation, then path and query parameters, body size (413),
JSON and schema validation of the body, the handler, and validation of the response against its
contract schema before it is sent. Every error is an RFC 9457 problem (`application/problem+json`)
without card content.

- Human-only operations (`x-human-only`) answer 403 to agent tokens. `proposal_create` answers
  403 to the session token. An unknown or unregistered token is 401.
- `Host` must be the bind host (or a loopback name) on the service port; `Origin`, when present,
  must be the service's own origin or one passed with `--allow-origin`. CORS answers only those.

## Disclosure

Every card in a response passes the reference gate (rules from `<state>/gate-rules.yaml`, rebuilt
when the file changes, which voids open transfers). Each decision is written to the gate log by a
fixed reason code. Denied cards are left out and listed by id and a fixed reason.

- Stances are served only through the human-only stance operations and appear in a context
  package for the screen only.
- A `cloud_model` connection never gets card content from search, card or Lage reads. Its first
  `context_package_get` returns `confirmationRequired` with a `transferId` and no content; after
  the human confirmed that transfer (`disclosure_confirm`), the same connection asks again with
  the `transferId` and receives exactly the confirmed cards once. The board sends with the
  `transferId` and the single-use token from the confirmation. The service rebuilds the envelope
  from the store at confirm and send time, so any edit changes the hash.
- `proposal_list` shows a `cloud_model` connection only its own proposals; a `local_model`
  sees all (proposal text may be derived from private cards).
- `world_list` shows a `cloud_model` connection public worlds only (a world has no gate decision
  of its own yet).

## Decisions of this slice that the contract leaves open

- Accepting a proposal: `place_card` and `move_card` write a new Lage version; `add_edge` writes a
  Lage edge (both cards must be placed) or, without `lageId`, an edge on the source card, with
  the agent as `by`; `create_card` creates the card with the agent as author and places it if
  asked; `comment` is accepted without a store change (no comment store in M1). A change that
  cannot be applied is a 409 and the proposal stays pending. The `note` of accept and reject is
  not stored.
- An agent card draft may not set `visibility`, `release`, `training` or `class` (400): those
  stay at the private defaults until the human changes them.
- `rules_evaluate` follows the rule card JSON (`card_on_lage`, `card_field`, `tag`, `edge`,
  `stance`). For a non-screen target a rule with a stance condition, a condition on a card the
  gate does not clear, or a rule card the gate does not clear is omitted and counted in
  `withheld`. `triggeringCardIds` are filled only for a rule that fired.
- `decision_save` merges the fields present in the body; the stored content hash must match.
- Origin roots follow `cites` and `based_on` edges among the cleared cards; a root with a
  `source` is identified by it, otherwise it is its own root and flagged unknown.

## Known gaps

- No gate rule fragments from adapters are passed yet (the `StorageAdapter` interface has none).
- Level-1 and export transfers (`purpose` other than `context_package`) can be previewed and
  confirmed but have no send path yet.
- No per-agent quota on pending proposals.
