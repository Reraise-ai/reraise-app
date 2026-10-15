// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Security tests (ADR-0026, ADR-0029, ADR-0011): token separation, registered connections,
// Host and Origin validation, loopback binding, size limits, safe start.

import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOperations } from './contract.js';
import { createService } from './service.js';
import { expectContract, HOST_HEADER, makeFixture, PORT, type Fixture } from './test-helpers.js';
import { MemoryStorageAdapter, MemoryStore } from '@worldbuilder/conformance';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let f: Fixture;
beforeAll(async () => {
  // This suite sends many bad credentials on purpose; the lock-out has its own tests (rate-limit.test.ts).
  f = await makeFixture({ bodyLimit: 4096, rateLimit: { authFailureMax: 1_000_000 } });
});
afterAll(async () => {
  await f.close();
});

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const body = {
  title: 'x',
  lage: {
    question: 'q?',
    options: [],
    cards: [],
    seats: [],
    edges: [],
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
};

/** One plausible request for every human-only operation of the contract. */
const HUMAN_ONLY: { id: string; method: string; url: string; payload?: unknown }[] = [
  { id: 'lage_create', method: 'POST', url: '/lagen', payload: body },
  { id: 'lage_save', method: 'PUT', url: `/lagen/${ULID}`, payload: body.lage },
  { id: 'lage_versions', method: 'GET', url: `/lagen/${ULID}/versions` },
  { id: 'scenario_get', method: 'GET', url: `/lagen/${ULID}/scenario` },
  {
    id: 'scenario_replace',
    method: 'PUT',
    url: `/lagen/${ULID}/scenario`,
    payload: { assumptions: [] },
  },
  {
    id: 'scenario_attach',
    method: 'POST',
    url: `/lagen/${ULID}/scenario/attach`,
    payload: { decisionId: ULID },
  },
  { id: 'scenario_attachment_get', method: 'GET', url: `/decisions/${ULID}/scenario` },
  { id: 'level1_get', method: 'GET', url: `/lagen/${ULID}/level1` },
  {
    id: 'model_ask',
    method: 'POST',
    url: `/lagen/${ULID}/model`,
    payload: { engine: 'ollama', question: 'What is claimed?' },
  },
  { id: 'findings_list', method: 'GET', url: '/findings' },
  {
    id: 'finding_pin',
    method: 'POST',
    url: '/findings/pin',
    payload: {
      connector: 'http-json',
      uri: 'https://example.invalid/memo',
      lageId: ULID,
    },
  },
  {
    id: 'level1_predict',
    method: 'POST',
    url: `/lagen/${ULID}/level1`,
    payload: { engine: 'local', trigger: { kind: 'manual' } },
  },
  {
    id: 'level1_escalate',
    method: 'POST',
    url: `/lagen/${ULID}/level1/escalate`,
    payload: { playerCardId: ULID },
  },
  { id: 'stance_get', method: 'GET', url: `/cards/${ULID}/stance` },
  {
    id: 'stance_save',
    method: 'PUT',
    url: `/cards/${ULID}/stance`,
    payload: { position: 'believed', weight: 1 },
  },
  { id: 'proposal_accept', method: 'POST', url: `/proposals/${ULID}/accept`, payload: {} },
  { id: 'proposal_reject', method: 'POST', url: `/proposals/${ULID}/reject`, payload: {} },
  { id: 'rule_create', method: 'POST', url: '/rules', payload: {} },
  { id: 'rule_save', method: 'PUT', url: `/rules/${ULID}`, payload: {} },
  { id: 'decision_create', method: 'POST', url: '/decisions', payload: {} },
  { id: 'decision_save', method: 'PUT', url: `/decisions/${ULID}`, payload: {} },
  { id: 'usage_metrics_get', method: 'GET', url: '/metrics/usage' },
  { id: 'training_export', method: 'POST', url: '/training/export', payload: {} },
  {
    id: 'source_profile_get',
    method: 'GET',
    url: '/source-profiles?source=https://example.invalid/none',
  },
  { id: 'disclosure_transfer_preview', method: 'POST', url: '/disclosure/transfers', payload: {} },
  { id: 'events_stream', method: 'GET', url: '/events' },
  { id: 'disclosure_transfer_get', method: 'GET', url: `/disclosure/transfers/${ULID}` },
  {
    id: 'disclosure_confirm',
    method: 'POST',
    url: `/disclosure/transfers/${ULID}/confirm`,
    payload: {},
  },
];

describe('human-only operations', () => {
  it('lists exactly the operations the contract marks human-only', () => {
    const fromContract = loadOperations()
      .filter((o) => o.access === 'human')
      .map((o) => o.id)
      .sort();
    expect(HUMAN_ONLY.map((h) => h.id).sort()).toEqual(fromContract);
  });

  for (const op of HUMAN_ONLY) {
    for (const agent of ['scripted', 'cloud-scripted']) {
      it(`${op.id} rejects the agent token of ${agent} with 403`, async () => {
        const res = await f.agent(agent, op.method, op.url, op.payload);
        expectContract(op.id, res, 403);
      });
    }
  }

  it('an agent token never reaches the stance of a card, even one that exists', async () => {
    await f.human('PUT', `/cards/${f.ids.evPublic}/stance`, { position: 'believed', weight: 3 });
    const res = await f.agent('scripted', 'GET', `/cards/${f.ids.evPublic}/stance`);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('believed');
  });
});

describe('proposal_create', () => {
  const proposal = { kind: 'comment', payload: { text: 'synthetic' } };
  it('rejects the human session token with 403', async () => {
    expectContract('proposal_create', await f.human('POST', '/proposals', proposal), 403);
  });
  it('rejects a request without credentials with 401', async () => {
    expectContract(
      'proposal_create',
      await f.raw({ method: 'POST', url: '/proposals', payload: proposal }),
      401,
    );
  });
  it('takes the author from the token, never from the body', async () => {
    const res = await f.agent('scripted', 'POST', '/proposals', {
      ...proposal,
      author: 'agent:other',
    });
    expect(res.statusCode).toBe(400);
    const ok = await f.agent('scripted', 'POST', '/proposals', proposal);
    expect(ok.json().author).toBe('agent:scripted');
  });
  it('refuses an agent card that sets visibility, release, training or class', async () => {
    for (const field of [
      { visibility: 'public' },
      { release: 'commercial' },
      { training: true },
      { class: 'A' },
    ]) {
      const res = await f.agent('scripted', 'POST', '/proposals', {
        kind: 'create_card',
        payload: { card: { format: 2, type: 'claim', title: 'T', ...field } },
      });
      expectContract('proposal_create', res, 400);
      expect(res.json().detail).toContain(Object.keys(field)[0]);
    }
  });
});

describe('credentials', () => {
  it('an unregistered bearer token is denied with 401, on every kind of operation', async () => {
    const headers = { authorization: 'Bearer not-a-registered-connection-token-0123456789' };
    for (const [method, url] of [
      ['GET', '/worlds'],
      ['GET', `/cards/${f.ids.evPublic}`],
      ['POST', '/proposals'],
    ] as const) {
      const res = await f.raw({
        method,
        url,
        headers,
        payload: method === 'POST' ? {} : undefined,
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });
  it('a wrong session token is 401; a session token is not accepted as a bearer token', async () => {
    expect(
      (
        await f.raw({
          method: 'GET',
          url: '/worlds',
          headers: { 'x-worldbuilder-session': 'wrong' },
        })
      ).statusCode,
    ).toBe(401);
    const res = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: { authorization: `Bearer ${f.service.sessionToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
  it('an agent token is not accepted in the session header', async () => {
    const res = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: { 'x-worldbuilder-session': f.tokens['scripted']! },
    });
    expect(res.statusCode).toBe(401);
  });
  it('two credentials at once are refused; a malformed Authorization header is 401', async () => {
    const both = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: {
        'x-worldbuilder-session': f.service.sessionToken,
        authorization: `Bearer ${f.tokens['scripted']}`,
      },
    });
    expect(both.statusCode).toBe(401);
    const odd = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: { authorization: 'Basic abc' },
    });
    expect(odd.statusCode).toBe(401);
  });
  it('a problem body is RFC 9457 and carries no card content', async () => {
    const res = await f.raw({ method: 'GET', url: `/cards/${f.ids.evPrivate}` });
    expect(res.json()).toMatchObject({ status: 401, title: expect.any(String) });
    expect(res.body).not.toContain('PRIVATE-MARKER-TEXT');
  });
});

describe('Host and Origin', () => {
  const session = () => ({ 'x-worldbuilder-session': f.service.sessionToken });
  it('rejects a foreign Host header (DNS rebinding) even with a valid token', async () => {
    const res = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: { ...session(), host: 'evil.example:4310' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().type).toContain('host-not-allowed');
  });
  it('rejects the right host on another port, and a missing Host', async () => {
    const res = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: { ...session(), host: '127.0.0.1:9' },
    });
    expect(res.statusCode).toBe(403);
  });
  it('accepts the loopback names on the service port', async () => {
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]) {
      const res = await f.raw({ method: 'GET', url: '/worlds', headers: { ...session(), host } });
      expect(res.statusCode, host).toBe(200);
    }
  });
  it('rejects a disallowed Origin and a null Origin, also for /health', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:9999']) {
      const res = await f.raw({ method: 'GET', url: '/worlds', headers: { ...session(), origin } });
      expect(res.statusCode, origin).toBe(403);
      expect(res.json().type).toContain('origin-not-allowed');
    }
    expect(
      (await f.raw({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } }))
        .statusCode,
    ).toBe(403);
  });
  it('accepts the service own origin and answers its preflight; refuses a foreign preflight', async () => {
    const own = `http://${HOST_HEADER}`;
    const res = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: { ...session(), origin: own },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(own);
    const pre = await f.raw({
      method: 'OPTIONS',
      url: '/proposals',
      headers: { origin: own, 'access-control-request-method': 'POST' },
    });
    expect(pre.statusCode).toBe(204);
    expect(String(pre.headers['access-control-allow-headers'])).toContain('x-worldbuilder-session');
    const foreign = await f.raw({
      method: 'OPTIONS',
      url: '/proposals',
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('applies to /mcp as well (the next slice mounts it behind the same hook)', async () => {
    const res = await f.raw({
      method: 'POST',
      url: '/mcp',
      payload: {},
      headers: { host: 'evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });
  it('allows extra origins and hosts only when configured', async () => {
    const other = await makeFixture();
    await other.close();
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-api-origin-'));
    const service = await createService({
      storage: new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
      stateDir: path.join(dir, 'state'),
      port: PORT,
      allowedOrigins: ['http://127.0.0.1:5173'],
    });
    const res = await service.app.inject({
      method: 'GET',
      url: '/worlds',
      headers: {
        host: HOST_HEADER,
        origin: 'http://127.0.0.1:5173',
        'x-worldbuilder-session': service.sessionToken,
      },
    });
    expect(res.statusCode).toBe(200);
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('size and format limits', () => {
  it('answers 413 above the body limit for every operation with a body', async () => {
    const big = { kind: 'comment', payload: { text: 'x'.repeat(10_000) } };
    expectContract('proposal_create', await f.agent('scripted', 'POST', '/proposals', big), 413);
    expectContract(
      'lage_create',
      await f.human('POST', '/lagen', { ...body, title: 'x'.repeat(10_000) }),
      413,
    );
    expectContract(
      'context_package_get',
      await f.human('POST', '/context-packages', { worldId: 'x'.repeat(10_000) }),
      413,
    );
  });
  it('answers 413 only after authentication', async () => {
    const res = await f.raw({
      method: 'POST',
      url: '/proposals',
      payload: { text: 'x'.repeat(10_000) },
    });
    expect(res.statusCode).toBe(401);
  });
  it('answers an over-long path parameter with a 414 problem, without quoting the path, after the Host check', async () => {
    const url = `/cards/${'a'.repeat(300)}`;
    const auth = { 'x-worldbuilder-session': f.service.sessionToken };
    const res = await f.raw({ method: 'GET', url, headers: auth });
    expect(res.statusCode).toBe(414);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json().status).toBe(414);
    expect(res.body).not.toContain('aaaaaaaa');
    const foreign = await f.raw({ method: 'GET', url, headers: { ...auth, host: 'evil.example' } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.headers['content-type']).toContain('application/problem+json');
  });
  it('answers 400 for malformed JSON and 415 for another media type', async () => {
    const bad = await f.raw({
      method: 'POST',
      url: '/proposals',
      payload: '{not json',
      headers: {
        authorization: `Bearer ${f.tokens['scripted']}`,
        'content-type': 'application/json',
      },
    });
    expect(bad.statusCode).toBe(400);
    const text = await f.raw({
      method: 'POST',
      url: '/proposals',
      payload: 'hello',
      headers: { authorization: `Bearer ${f.tokens['scripted']}`, 'content-type': 'text/plain' },
    });
    expect(text.statusCode).toBe(415);
  });
  it('answers 404 as a problem for an unknown route', async () => {
    const res = await f.human('GET', '/nope');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('session token and start-up', () => {
  it('writes the session token to a file readable by the owner only', async () => {
    const file = f.service.sessionTokenFile;
    expect((await readFile(file, 'utf8')).trim()).toBe(f.service.sessionToken);
    expect(f.service.sessionToken.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
  it('generates a new session token at every start', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-api-token-'));
    const open = () =>
      createService({
        storage: new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
        stateDir: path.join(dir, 'state'),
        port: PORT,
      });
    const a = await open();
    await a.close();
    const b = await open();
    expect(b.sessionToken).not.toBe(a.sessionToken);
    expect((await readFile(b.sessionTokenFile, 'utf8')).trim()).toBe(b.sessionToken);
    await b.close();
    await rm(dir, { recursive: true, force: true });
  });
  it('binds 127.0.0.1 by default', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-api-bind-'));
    const service = await createService({
      storage: new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
      stateDir: path.join(dir, 'state'),
      port: 0,
    });
    try {
      expect(service.host).toBe('127.0.0.1');
      const bound = await service.listen();
      expect(bound.host).toBe('127.0.0.1');
      const res = await fetch(`http://127.0.0.1:${bound.port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    } finally {
      await service.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('refuses to start when the state directory is inside a store root', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-api-unsafe-'));
    const root = path.join(dir, 'store');
    await mkdir(root, { recursive: true });
    await expect(
      createService({
        storage: new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
        stateDir: path.join(root, '.state'),
        storeRoots: [root],
        port: PORT,
      }),
    ).rejects.toMatchObject({ code: 'unsafe_state_dir' });
    await rm(dir, { recursive: true, force: true });
  });
  it('refuses to start when the state directory is inside a Git working tree, also through a symlink', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-api-git-'));
    await mkdir(path.join(dir, 'repo', '.git'), { recursive: true });
    const storage = new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID()));
    await expect(
      createService({ storage, stateDir: path.join(dir, 'repo', 'state'), port: PORT }),
    ).rejects.toMatchObject({ code: 'unsafe_state_dir' });
    try {
      await symlink(path.join(dir, 'repo'), path.join(dir, 'link'));
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // Windows without privilege
      throw e;
    }
    await expect(
      createService({ storage, stateDir: path.join(dir, 'link', 'state'), port: PORT }),
    ).rejects.toMatchObject({ code: 'unsafe_state_dir' });
    await rm(dir, { recursive: true, force: true });
  });
  it('refuses to start with an invalid or world-readable agents.yaml', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-api-agents-'));
    const state = path.join(dir, 'state');
    await mkdir(state, { recursive: true, mode: 0o700 });
    const storage = new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID()));
    const file = path.join(state, 'agents.yaml');
    await writeFile(file, 'connections:\n  - { name: x, target: everyone, token: short }\n', {
      mode: 0o600,
    });
    await expect(createService({ storage, stateDir: state, port: PORT })).rejects.toThrow(/target/);
    if (process.platform !== 'win32') {
      await writeFile(file, 'connections: []\n');
      await chmod(file, 0o644);
      await expect(createService({ storage, stateDir: state, port: PORT })).rejects.toThrow(
        /chmod 600/,
      );
    }
    await rm(dir, { recursive: true, force: true });
  });
});

describe('agent registry', () => {
  it('picks up a newly registered connection while running, and denies all on a broken file', async () => {
    const { addAgent } = await import('./agent-registry.js');
    const { token } = await addAgent(f.stateDir, { name: 'late', target: 'local_model' });
    const ok = await f.raw({
      method: 'GET',
      url: '/worlds',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(f.service.agents.connections.map((c) => c.name)).toContain('late');
    const file = path.join(f.stateDir, 'agents.yaml');
    await writeFile(file, 'connections: [ {', { mode: 0o600 });
    const broken = await f.agent('scripted', 'GET', '/worlds');
    expect(broken.statusCode).toBe(401);
    expect(f.service.agents.error).toMatch(/YAML/);
    expect(f.service.agents.connections).toEqual([]);
  });
});
