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
                   [--allow-host <host>]... [--allow-origin http://127.0.0.1:5173]...
worldbuilder agent add <name> --target local_model|cloud_model [--state <dir>] [--token-file <path>]
worldbuilder agent list [--state <dir>]
worldbuilder agent remove <name> [--state <dir>]
```

`serve` opens the store with the markdown-files adapter (tested on a copy of the Hormuz
example, `src/hormuz.test.ts`) and binds `127.0.0.1` by default, creates a fresh human session token at every start, writes
it to `<state>/session-token` (owner-only) and prints it once. It refuses to start when the state
directory lies inside the store or a Git working tree (symbolic links followed) or when
`agents.yaml` is invalid or readable by others. On first start it writes a gate rule file that
allows cards on the screen only; without a rule the gate denies everything, also on the screen.
Binding another host prints a warning: put your own access control in front.

`agent add` registers one agent connection in `<state>/agents.yaml` (schema
`schemas/agent-connections.schema.json`, ADR-0037) and prints its bearer token once, or writes it to
an owner-only file with `--token-file` (the agent reads it from `WORLDBUILDER_AGENT_TOKEN_FILE`);
only the SHA-256 of the token is stored. The file is re-read when it changes and must be mode 0600
on POSIX. Each connection has a target class: `local_model` or `cloud_model`. `agent list` shows
name, target and creation time of the active connections, never a token; `agent remove` revokes a
token at once (the record stays, so a name is never reused for another token). The three agent
commands resolve the state directory exactly like `serve` (per-OS default or `--state`, never
inside a store passed with `--store` or a Git working tree, symbolic links followed). The whole
registry format lives in `src/agent-registry.ts`. The names `local` and `jev` (any letter case), and the id of any configured level-1 engine, are reserved: both act as `agent:<name>` (ADR-0035, ADR-0037).

`--allow-host` (repeatable) adds Host header values for a reverse proxy; a bare name gets the service
port. Binding beyond loopback, or allowing another Host, prints a loud warning: put your own access
control in front.

## Knowledge loop (ADR-0039 to ADR-0042)

One service per state directory: `<state>/service.lock` (ADR-0040); a second `serve` on it refuses to start.

- `knowledge_consult` (agent only) runs the `context_package_get` path with the task as the
  question and appends a Knowledge Receipt to `<state>/receipt-log.jsonl`. The receipt holds ids,
  hashes and codes; the task text is hashed with the device key `<state>/receipt-key` (created
  owner-only on first use) and never stored. The log is opened, and its whole chain verified, before
  any content is prepared: a broken log answers 503 and nothing is delivered.
- `knowledge_write_back` records "not needed" with a coded reason (`already_covered` must name cards
  the agent may know) or creates a `create_card` proposal; both return a Write-back Receipt.
  `decision_record` and `decision_outcome` create proposals only. Accepting a `record_outcome`
  proposal patches only `sections.outcome`, and only if the decision still has `expectedContentHash`
  (409 otherwise, the proposal stays pending).
- `memory_route` is the pure classifier of ADR-0042 for the session and for agents; it stores nothing.
- `usage_metrics_get` (human only) derives the metrics from the receipt log, task records in
  `<state>/tasks`, proposals and decision cards. The atlas lag is reported as unknown (its target is
  not met): `wb metrics` reads the atlas pages, the service does not yet.
- Verify receipts with `wb receipts verify <task records> --log <state>/receipt-log.jsonl`.

## MCP at `/mcp` and the stdio bridge (ADR-0016, ADR-0029)

The same process serves MCP over Streamable HTTP at `/mcp` (`src/mcp.ts`, the tools and sessions
come from `@worldbuilder/mcp-server`). A tool call runs `executeOperation` (`src/execute.ts`),
the function the HTTP route of the same operation runs: argument checks, access rule, handler,
response check against the contract. So the gate, the cloud confirmation, the proposal list and
the receipt log are shared by construction, and a failure maps through `describeError`
(`src/errors.ts`) to the same problem details, delivered as an MCP tool error with that text
only.

- Credentials: `/mcp` takes a registered agent's bearer token only; the human session token is
  403 there, an unknown or revoked token is 401 (checked on every request, also inside an open
  session). Host and Origin are checked like on every route; the body limit and JSON parser are
  the same (413 above the limit).
- Sessions: `Mcp-Session-Id`, JSON answers to POST, the GET stream for server-initiated
  messages. A session is bound to the connection that opened it: name, target class and token
  hash. A request with another credential, or after the connection was reclassified or got a new
  token, looks like an unknown session (404). Every tool call runs as the principal of the HTTP
  request that carries it, never as the one that opened the session. When `agents.yaml` changes
  (the service looks at it every 2 seconds and on every request) the sessions and open GET
  streams of revoked, re-tokened or reclassified connections are closed. At most 16 sessions per
  connection (the least recently used is closed; the check and the insert are one step), a session
  with no request and no open stream for 30 minutes closes, all close with the service.
- Tools: exactly the entries of `packages/mcp-server/src/tools.ts`. Startup fails if a tool has
  no operation or names a human-only one. No human-only operation is listed and calling one by
  name is a tool error.
- Target class: the registered connection's class applies. A `cloud_model` connection gets
  `confirmationRequired` with a `transferId` and no content first, and the confirmed cards only
  after the human confirmed that transfer (ADR-0031).
- `worldbuilder mcp --stdio [--url <service URL>]`: the stateless bridge (`bridge.ts` of the MCP
  package). Token from `WORLDBUILDER_AGENT_TOKEN_FILE` (or `WORLDBUILDER_AGENT_TOKEN`), service
  URL from `--url` or `WORLDBUILDER_URL` (default `http://127.0.0.1:4310`). It never writes a
  file, relays `Mcp-Session-Id` and the server stream, and exits 1 with a clear message if the
  service is not running. Plain `http://` is accepted for this machine only (127.0.0.1, `::1`,
  `localhost`); any other host needs `https://`, because the bearer token would otherwise cross
  the network in clear text. If the service answers 404 "session not found" (idle expiry, a restart),
  the bridge replays the host's `initialize` and `initialized` on a fresh connection with its own
  request id (the host never sees that answer) and sends the failed message again, once. If the
  new session cannot be opened it answers the request with an error, prints "session expired" and
  exits non-zero.

Tests: `src/mcp.test.ts` (official SDK client over a real loopback port), `src/mcp-bridge.test.ts`
(the bridge as a child process).

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
- `world_list` shows a `local_model` or `cloud_model` connection only the worlds with at least one
  card the gate clears for it (for `cloud_model`: clears after a confirmed transfer); a world has no
  gate decision of its own.
- `cards_search` of a model target filters after the gate: the text, type and layer filters run
  over cleared cards only and the answer never lists denied cards, so a query for text in a denied
  card looks like a query for absent text. Only an explicit id lookup says "no".
- A context package for a Lage needs the Lage in the requested world and, for a model target, the
  Lage cleared by the gate; a hidden Lage answers like a missing one (404, byte-identical). A world
  with no card cleared for a model target answers like an unknown world (empty package, no count).

## Level 1 (ADR-0035, ADR-0045)

Three human-only operations (agents get 403; none is an MCP tool):

- `GET /lagen/{lageId}/level1` (`level1_get`): the engines on offer and the latest prediction held
  in memory, with `stale`; `?explain=true` adds the basis of the local engine while it is current.
- `POST /lagen/{lageId}/level1` (`level1_predict`): `{ engine: "local" | <cloud engine id>,
trigger, transferId?, confirmationToken? }`. `local` is the built-in deterministic engine,
  cleared as the screen. A cloud engine answers `confirmation_required` with the previewed
  envelope first; after `disclosure_confirm` the same call with `transferId` and the token sends
  exactly the confirmed objects, once. Statuses: `predicted`, `confirmation_required`,
  `no_players`, `superseded` (the board changed while the engine ran; nothing is stored).
- `POST /lagen/{lageId}/level1/escalate` (`level1_escalate`): `{ playerCardId }` creates a Lage for
  that player from the latest, still current prediction, with a `based_on` edge to the source.

The request is built from the cards on the Lage and the user's applicable rule cards, each
cleared by the gate; a rejected assumption is left out and no stance is sent. Predictions live in
memory only: never in a card, the store, the gate log or a context package.

Cloud engines are listed in `<state>/level1-engines.yaml` (schema `level1-engines.schema.json`);
there is none by default and `jev` is shown as unavailable until an enabled entry exists. The
credential is the path of an owner-only file (`apiKeyFile`), never a value in the YAML. The ids
`local`, `local-rules`, `jev` and every configured engine id cannot be used as an agent name.
Tests: `src/level1.test.ts`.

## Decisions of this slice that the contract leaves open

- Accepting a proposal: `place_card` and `move_card` write a new Lage version; `add_edge` writes a
  Lage edge (both cards must be placed) or, without `lageId`, an edge on the source card, with
  the agent as `by`; `create_card` creates the card with the agent as author and places it if
  asked; `comment` is accepted without a store change (no comment store in M1). A change that
  cannot be applied is a 409 and the proposal stays pending. The `note` of accept and reject is
  not stored.
- An agent card draft may not set `worlds`, `tags`, `rating`, `class`, `visibility`, `release` or
  `training` (400), and every edge of it must be drawn by the proposing agent (a `human` edge is a
  400 at create and a 409 at accept). A created card joins the worlds of the Lage it is placed on;
  the rest stays at the private defaults until the human changes it.
- Storage failures are typed (`StorageError`): `not_found` 404, `conflict` 409, `invalid` 400,
  `locked` 503 with `Retry-After`; the detail is fixed wording, never the adapter's message. A
  proposal whose change the store refuses is a 409 and stays pending.
- `rules_evaluate` follows the rule card JSON (`card_on_lage`, `card_field`, `tag`, `edge`,
  `stance`). For a non-screen target a rule with a stance condition, a condition on a card the
  gate does not clear, an edge condition that matches an edge touching such a card, or a rule card
  the gate does not clear is omitted and counted in `withheld`. `triggeringCardIds` are filled only for a rule that fired.
- `decision_save` merges the fields present in the body; the stored content hash must match.
- Origin roots follow `cites` and `based_on` edges among the cleared cards; a root with a
  `source` is identified by it, otherwise it is its own root and flagged unknown.

## Known gaps

- MCP: no server-initiated notifications for proposals or Lage changes yet (the stream only
  carries `tools/list_changed`); agents poll `proposal_list` with `changedSince` (ADR-0032).
  `/mcp` sends no CORS headers: it is for agents, not for browser pages.
- The bridge re-opens an expired session once per failed message; it does not retry a service
  that is down, and the host's own state about the old session (for example subscriptions) is not
  replayed beyond `initialize` and `initialized`.

- No gate rule fragments from adapters are passed yet (the `StorageAdapter` interface has none).
- Export transfers (`purpose: export`) can be previewed and confirmed but have no send path yet
  (`level1` transfers have one, see Level 1).
- Level 1: Lage edges drawn on the board are not part of the engine request yet; the real Jev wire
  format is unconfirmed (OD-4), so the Jev preset is a template tested against a fake service.
- No per-agent quota on pending proposals.
- The atlas lag of `usage_metrics_get` is unknown (see above); task records are read from
  `<state>/tasks` (files that are not task records count as no task).
- A card write-back whose receipt cannot be written is withdrawn: its proposal is rejected (the
  schema records every decision as the human's) and the answer is 503.
- A `consultReceiptId` passed to `knowledge_write_back` is not checked against the log at write
  time; the verifier reports a mismatch (`unlinked`).
