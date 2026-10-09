// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Shared fixture of the service tests: the in-memory fake store with synthetic cards, a real
// local state in a temporary directory, gate rules and registered agent connections.

import { MemoryStorageAdapter, MemoryStore } from '@worldbuilder/conformance';
import type { Card } from '@worldbuilder/core';
import type { LightMyRequestResponse } from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addAgent } from './agent-registry.js';
import type { AgentTarget } from './auth.js';
import { loadOperations, Validators } from './contract.js';
import { createService, type Service, type ServiceOptions } from './service.js';
import { newUlid } from './util.js';

export const PORT = 4310;
export const HOST_HEADER = `127.0.0.1:${PORT}`;

/** Rules of the fixture: the screen sees everything, models see public cards only. */
export const FIXTURE_RULES = `rules:
  - { id: screen-all, effect: allow, targets: [screen], match: {} }
  - { id: public-to-models, effect: allow, targets: [local_model, cloud_model], match: { visibility: [public] } }
`;

export const PRIVATE_TEXT = 'PRIVATE-MARKER-TEXT';

export interface Fixture {
  readonly service: Service;
  readonly store: MemoryStore;
  readonly adapter: MemoryStorageAdapter;
  readonly stateDir: string;
  readonly worldId: string;
  readonly ids: {
    readonly evPublic: string;
    readonly evPrivate: string;
    readonly evCopy: string;
    readonly evLoose: string;
    readonly lage: string;
    readonly rule: string;
    readonly stanceRule: string;
  };
  readonly tokens: Readonly<Record<string, string>>;
  /** Base URL of the listening service (`listen: true` only); `inject` calls need `HOST_HEADER`. */
  readonly url: string;
  /** Call as the human (session token) or as a registered agent (bearer token). */
  human(method: string, url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  agent(
    name: string,
    method: string,
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse>;
  raw(opts: {
    method: string;
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export interface FixtureOptions {
  /** Rule file text; `null` writes none. */
  readonly rules?: string | null;
  readonly agents?: Readonly<Record<string, AgentTarget>>;
  readonly bodyLimit?: number;
  /** Rate limits of the service (defaults when omitted). */
  readonly rateLimit?: ServiceOptions['rateLimit'];
  /** Listen on a free loopback port (real HTTP, for the MCP tests); `url` is set then. */
  readonly listen?: boolean;
  readonly now?: () => Date;
  /** Level-1 seams: an injected `fetch` for cloud engines, a replacement local engine. */
  readonly level1?: ServiceOptions['level1'];
  /** Files written into the state directory before the start (owner-only, for example keys). */
  readonly stateFiles?: Readonly<Record<string, string>>;
}

export async function makeFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const base = await mkdtemp(path.join(tmpdir(), 'wb-api-'));
  const stateDir = path.join(base, 'state');
  const store = new MemoryStore(crypto.randomUUID(), 'native');
  const adapter = new MemoryStorageAdapter(store);
  const worldId = newUlid();
  store.worlds.push({ id: worldId, name: 'Synthetic world', visibility: 'private' });
  store.worlds.push({ id: newUlid(), name: 'Synthetic public world', visibility: 'public' });

  const seed = (fields: Record<string, unknown>) =>
    store.seed(store.nextExternalId(), {
      format: 2,
      author: 'human',
      worlds: [worldId],
      ...fields,
    });
  const evPublic = seed({
    type: 'claim',
    title: 'Synthetic public claim',
    body: 'Alpha body.',
    layer: 'evidenced',
    source: 'https://example.invalid/report-a',
    sourceDate: '2026-01-01',
    visibility: 'public',
  });
  const evPrivate = seed({
    type: 'claim',
    title: 'Synthetic private note',
    body: PRIVATE_TEXT,
    layer: 'said',
    originSystem: 'Synthetic desk',
    visibility: 'private',
  });
  const evCopy = seed({
    type: 'claim',
    title: 'Synthetic repeated claim',
    body: 'Alpha again.',
    layer: 'said',
    originSystem: 'Synthetic desk',
    visibility: 'public',
    edges: [{ target: evPublic, kind: 'cites', by: 'human' }],
  });
  const evLoose = seed({
    type: 'claim',
    title: 'Synthetic loose claim',
    body: 'Beta body.',
    layer: 'evidenced',
    source: 'https://example.invalid/report-b',
    visibility: 'public',
  });
  const lage = seed({
    type: 'lage',
    title: 'Synthetic Lage',
    visibility: 'public',
    lage: {
      question: 'Which option?',
      options: ['A', 'B'],
      cards: [{ id: evPublic, x: 0, y: 0 }],
      seats: [{ name: 'Me', kind: 'human' }],
      edges: [],
      version: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  });
  const rule = seed({
    type: 'rule',
    title: 'Synthetic rule',
    visibility: 'public',
    rule: { when: [{ kind: 'card_on_lage', card: evPublic }], then: 'Prefer option A' },
  });
  const stanceRule = seed({
    type: 'rule',
    title: 'Synthetic stance rule',
    visibility: 'public',
    rule: {
      when: [{ kind: 'stance', card: evPublic, position: 'believed' }],
      then: 'Prefer option B',
    },
  });

  const { mkdir } = await import('node:fs/promises');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (options.rules !== null) {
    await writeFile(path.join(stateDir, 'gate-rules.yaml'), options.rules ?? FIXTURE_RULES);
  }
  for (const [name, text] of Object.entries(options.stateFiles ?? {})) {
    await writeFile(path.join(stateDir, name), text, { mode: 0o600 });
  }
  const tokens: Record<string, string> = {};
  const agents = options.agents ?? { scripted: 'local_model', 'cloud-scripted': 'cloud_model' };
  for (const [name, target] of Object.entries(agents)) {
    tokens[name] = (await addAgent(stateDir, { name, target })).token;
  }

  const service = await createService({
    storage: adapter,
    stateDir,
    port: options.listen ? 0 : PORT,
    ...(options.bodyLimit !== undefined ? { bodyLimit: options.bodyLimit } : {}),
    ...(options.rateLimit !== undefined ? { rateLimit: options.rateLimit } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.level1 ? { level1: options.level1 } : {}),
  });
  const bound = options.listen ? await service.listen() : undefined;
  const raw: Fixture['raw'] = (opts) =>
    service.app.inject({
      ...opts,
      headers: { host: HOST_HEADER, ...opts.headers },
    } as never);
  return {
    service,
    store,
    adapter,
    stateDir,
    worldId,
    ids: { evPublic, evPrivate, evCopy, evLoose, lage, rule, stanceRule },
    tokens,
    url: bound ? `http://127.0.0.1:${bound.port}` : '',
    human: (method, url, payload) =>
      raw({ method, url, payload, headers: { 'x-worldbuilder-session': service.sessionToken } }),
    agent: (name, method, url, payload) =>
      raw({ method, url, payload, headers: { authorization: `Bearer ${tokens[name]}` } }),
    raw,
    close: async () => {
      await service.close();
      await rm(base, { recursive: true, force: true });
    },
  };
}

const operations = loadOperations();
const checker = new Validators();
export const covered = new Set<string>();

/**
 * Assert that a response is what the OpenAPI contract allows for the operation: a declared
 * status, the right media type, and a body that validates against the contract schema.
 */
export function expectContract(
  operationId: string,
  res: { statusCode: number; headers: Record<string, unknown>; body: string; json(): unknown },
  expectedStatus?: number,
): void {
  const op = operations.find((o) => o.id === operationId);
  if (!op) throw new Error(`unknown operation ${operationId}`);
  covered.add(operationId);
  if (expectedStatus !== undefined && res.statusCode !== expectedStatus) {
    throw new Error(
      `${operationId}: expected ${expectedStatus}, got ${res.statusCode}: ${res.body.slice(0, 300)}`,
    );
  }
  const declared = op.responses.get(res.statusCode);
  if (!declared) {
    throw new Error(`${operationId}: status ${res.statusCode} is not declared in the contract`);
  }
  const type = String(res.headers['content-type'] ?? '');
  const want = declared.problem ? 'application/problem+json' : 'application/json';
  if (!type.startsWith(want))
    throw new Error(`${operationId}: content type ${type}, wanted ${want}`);
  if (declared.schemaRef) {
    const result = checker.strict(declared.schemaRef)(res.json());
    if (!result.ok)
      throw new Error(`${operationId}: ${res.statusCode} body invalid: ${result.message}`);
  }
}

export const cardOf = (res: { json(): unknown }) => res.json() as Card;
