// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The worldbuilder command line and the composition root.

import { MemoryStorageAdapter, MemoryStore } from '@worldbuilder/conformance';
import { createLocalStateStore } from '@worldbuilder/local-state';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from './auth.js';
import { main } from './main.js';
import { createService, DEFAULT_GATE_RULES, type Service } from './service.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wb-api-cli-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sink = () => {
  const chunks: string[] = [];
  return { write: (t: string) => chunks.push(t), text: () => chunks.join('') };
};
const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

describe('worldbuilder agent add', () => {
  it('registers a connection, prints the token once and stores only its hash', async () => {
    const state = path.join(dir, 'state');
    const out = sink();
    const code = await main(
      ['agent', 'add', '--name', 'hermes-a', '--target', 'cloud_model', '--state', state],
      { stdout: out },
    );
    expect(code).toBe(0);
    const token = out.text().trim().split('\n').pop()!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    const file = path.join(state, 'agents.json');
    const stored = await readFile(file, 'utf8');
    expect(stored).not.toContain(token);
    expect(JSON.parse(stored).agents[0]).toMatchObject({ name: 'hermes-a', target: 'cloud_model' });
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    const registry = new AgentRegistry(file);
    await registry.loadStrict();
    await expect(registry.lookup(token)).resolves.toMatchObject({
      name: 'hermes-a',
      target: 'cloud_model',
      author: 'agent:hermes-a',
    });
    await expect(registry.lookup('nope')).resolves.toBeUndefined();
  });
  it('refuses a duplicate name (1) and a bad target or name (2 / 1)', async () => {
    const args = [
      'agent',
      'add',
      '--name',
      'dup',
      '--target',
      'local_model',
      '--state',
      path.join(dir, 's'),
    ];
    expect(await main(args, { stdout: sink() })).toBe(0);
    const err = sink();
    expect(await main(args, { stdout: sink(), stderr: err })).toBe(1);
    expect(err.text()).toContain('already registered');
    expect(
      await main(['agent', 'add', '--name', 'x', '--target', 'moon', '--state', dir], {
        stderr: sink(),
      }),
    ).toBe(2);
    expect(
      await main(['agent', 'add', '--name', '../x', '--target', 'local_model', '--state', dir], {
        stderr: sink(),
      }),
    ).toBe(1);
  });
});

describe('worldbuilder usage', () => {
  it('prints usage for a bad command and for serve without --store', async () => {
    const err = sink();
    expect(await main(['bogus'], { stderr: err })).toBe(2);
    expect(err.text()).toContain('Usage');
    expect(await main(['serve'], { stderr: sink() })).toBe(2);
    expect(await main(['serve', '--store', dir, '--port', 'abc'], { stderr: sink() })).toBe(2);
  });
  it('leaves a clear seam for the MCP bridge', async () => {
    const err = sink();
    expect(await main(['mcp', '--stdio'], { stderr: err })).toBe(1);
    expect(err.text()).toContain('MCP');
  });
  it('fails cleanly when the store cannot be opened', async () => {
    const err = sink();
    const code = await main(
      ['serve', '--store', path.join(dir, 'nothing-here'), '--state', path.join(dir, 'st')],
      { stderr: err },
    );
    expect(code).toBe(1);
    expect(err.text()).toMatch(/^worldbuilder: /);
  });
});

describe('worldbuilder serve', () => {
  it('starts on loopback, prints the token once, seeds screen-only rules and answers over HTTP', async () => {
    const out = sink();
    const port = await freePort();
    let service: Service | undefined;
    const code = await main(
      [
        'serve',
        '--store',
        path.join(dir, 'store'),
        '--state',
        path.join(dir, 'state'),
        '--port',
        String(port),
      ],
      {
        stdout: out,
        stderr: sink(),
        logger: false,
        openStore: async () => new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
        onServe: (s) => {
          service = s;
        },
      },
    );
    try {
      expect(code).toBe(-1);
      expect(out.text()).toContain(`http://127.0.0.1:${port}`);
      expect(out.text()).toContain(service!.sessionToken);
      const rules = await readFile(path.join(dir, 'state', 'gate-rules.yaml'), 'utf8');
      expect(rules).toBe(DEFAULT_GATE_RULES);
      const res = await fetch(`http://127.0.0.1:${port}/worlds`, {
        headers: { 'x-worldbuilder-session': service!.sessionToken },
      });
      expect(res.status).toBe(200);
      const foreign = await fetch(`http://127.0.0.1:${port}/worlds`, {
        headers: {
          'x-worldbuilder-session': service!.sessionToken,
          origin: 'https://evil.example',
        },
      });
      expect(foreign.status).toBe(403);
    } finally {
      await service?.close();
    }
  });
  it('refuses a state directory inside the store', async () => {
    const err = sink();
    const store = path.join(dir, 'store');
    await mkdir(store, { recursive: true });
    const code = await main(
      ['serve', '--store', store, '--state', path.join(store, 'state'), '--port', '4399'],
      {
        stderr: err,
        openStore: async () => new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
      },
    );
    expect(code).toBe(1);
    expect(err.text()).toContain('store root');
  });
});

describe('createService', () => {
  it('the seeded default rules validate, allow the screen and nothing else', async () => {
    const state = path.join(dir, 'state');
    const service = await createService({
      storage: new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
      stateDir: state,
      port: 4310,
      seedDefaultGateRules: true,
    });
    await service.close();
    const local = await createLocalStateStore({ explicitPath: state });
    const load = await local.loadGateRules();
    expect(load.ok).toBe(true);
    expect(load.effective.map((r) => [r.id, r.effect, r.targets])).toEqual([
      ['screen-all', 'allow', ['screen']],
    ]);
  });
  it('does not overwrite rules the user wrote', async () => {
    const state = path.join(dir, 'state');
    await mkdir(state, { recursive: true, mode: 0o700 });
    await writeFile(path.join(state, 'gate-rules.yaml'), 'rules: []\n');
    const service = await createService({
      storage: new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
      stateDir: state,
      port: 4310,
      seedDefaultGateRules: true,
    });
    await service.close();
    expect(await readFile(path.join(state, 'gate-rules.yaml'), 'utf8')).toBe('rules: []\n');
  });
  it('starts the contract check: every operation has a handler', async () => {
    const { handlers } = await import('./operations.js');
    const { loadOperations } = await import('./contract.js');
    expect(Object.keys(handlers).sort()).toEqual(
      loadOperations()
        .map((o) => o.id)
        .sort(),
    );
  });
});
