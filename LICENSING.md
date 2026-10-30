# Licensing

The Worldbuilder uses a two-tier, [REUSE](https://reuse.software/)-style licensing scheme.
Full texts are in [`LICENSES/`](LICENSES/). Every source file carries an
`SPDX-License-Identifier` header, and every package has its own `LICENSE` file.
CI enforces that headers match the tier of the directory (`pnpm check:spdx`).

Copyright: The Worldbuilder contributors.

## Which licence applies where

| Directory                                         | Licence           |
| ------------------------------------------------- | ----------------- |
| `packages/core`                                   | Apache-2.0        |
| `packages/adapters/*`                             | Apache-2.0        |
| `packages/disclosure-gate`                        | Apache-2.0        |
| `packages/local-state`                            | Apache-2.0        |
| `packages/knowledge-loop`                         | Apache-2.0        |
| `packages/level1-engines`                         | Apache-2.0        |
| `packages/training-export`                        | Apache-2.0        |
| `packages/conformance`                            | Apache-2.0        |
| `integrations/hermes`                             | Apache-2.0        |
| `schemas/`                                        | Apache-2.0        |
| `examples/`                                       | Apache-2.0        |
| `docs/` (including the card format specification) | Apache-2.0        |
| `scripts/`, `.github/`, root tooling              | Apache-2.0        |
| `apps/board`                                      | AGPL-3.0-or-later |
| `services/api`                                    | AGPL-3.0-or-later |
| `packages/mcp-server`                             | AGPL-3.0-or-later |
| `e2e/` (Playwright tests of the above)            | AGPL-3.0-or-later |

`prototype/` is a frozen early concept and follows the Apache-2.0 tier. The two CLA texts in
`legal/cla/` are derived from the Harmony agreements and are licensed CC-BY-3.0
(see `REUSE.toml`); the entity records next to them follow the Apache-2.0 tier.

## Why two tiers

- **Open formats and libraries (Apache-2.0).** The card format, schemas, SDK-style
  libraries and storage/source/model adapters should be adoptable by anyone, including
  operators of their own agent systems and note-taking vaults, without licence friction.
  Interoperability is the point of a card format.
- **The application (AGPL-3.0-or-later).** The board app, the API service and the MCP
  server are the product. The AGPL keeps improvements open even when the software is
  offered as a network service.

The hosted platform (card exchange) is a separate service and is not part of this repository.

## Contributions, DCO and CLA

By contributing you certify the [Developer Certificate of Origin](https://developercertificate.org/)
by signing off every commit (`git commit -s`). Your contribution is licensed under the
licence of the directory it lands in.

Contributions to the AGPL-3.0-or-later directories (`apps/board`, `services/api`,
`packages/mcp-server`, `e2e`) also need a signed Contributor License Agreement
([individual](legal/cla/CLA-INDIVIDUAL.md), [entity](legal/cla/CLA-ENTITY.md)). You keep your
copyright. The AGPL-3.0-or-later parts are also offered by Caprey SAS under other terms, for
example commercial licences. In return, Caprey SAS commits that every contribution stays
publicly available under AGPL-3.0-or-later. The Apache-2.0 directories are not covered by the
CLA. See [CONTRIBUTING.md](CONTRIBUTING.md).

## SPDX header

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
```

Use `AGPL-3.0-or-later` in the AGPL directories. CSS files use `/* ... */` comments.
