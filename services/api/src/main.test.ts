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
import { parse } from 'yaml';
import { AgentRegistry } from './agent-registry.js';
import { main, normaliseAllowedHost } from './main.js';
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
    const file = path.join(state, 'agents.yaml');
    const stored = await readFile(file, 'utf8');
    expect(stored).not.toContain(token);
    expect(parse(stored).connections[0]).toMatchObject({ name: 'hermes-a', target: 'cloud_model' });
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

describe('worldbuilder agent list and remove', () => {
  it('lists names and targets only, and removing a connection revokes its token', async () => {
    const state = path.join(dir, 'state');
    const out = sink();
    await main(['agent', 'add', '--name', 'a1', '--target', 'local_model', '--state', state], {
      stdout: out,
    });
    const token = out.text().trim().split('\n').pop()!;
    await main(['agent', 'add', '--name', 'a2', '--target', 'cloud_model', '--state', state], {
      stdout: sink(),
    });
    const list = sink();
    expect(await main(['agent', 'list', '--state', state], { stdout: list })).toBe(0);
    expect(list.text().split('\n').filter(Boolean)).toMatchObject([
      expect.stringMatching(/^agent:a1\tlocal_model\t\d{4}-\d\d-\d\dT/),
      expect.stringMatching(/^agent:a2\tcloud_model\t\d{4}-\d\d-\d\dT/),
    ]);
    expect(list.text()).not.toContain(token);
    const registry = new AgentRegistry(path.join(state, 'agents.yaml'));
    await registry.loadStrict();
    await expect(registry.lookup(token)).resolves.toMatchObject({ name: 'a1' });
    expect(
      await main(['agent', 'remove', '--name', 'a1', '--state', state], { stdout: sink() }),
    ).toBe(0);
    await expect(registry.lookup(token)).resolves.toBeUndefined();
    const err = sink();
    expect(await main(['agent', 'remove', '--name', 'a1', '--state', state], { stderr: err })).toBe(
      1,
    );
    expect(err.text()).toContain('no active agent named a1');
    expect(await main(['agent', 'remove', '--state', state], { stderr: sink() })).toBe(2);
    const empty = sink();
    await main(['agent', 'list', '--state', path.join(dir, 'none')], { stdout: empty });
    expect(empty.text()).toContain('No agent connections');
  });
});

describe('worldbuilder agent: state directory and names', () => {
  it('takes the name as a positional argument (ADR-0037) or with --name, and hides revoked agents', async () => {
    const state = path.join(dir, 'state');
    expect(
      await main(['agent', 'add', 'pos-agent', '--target', 'local_model', '--state', state], {
        stdout: sink(),
      }),
    ).toBe(0);
    const list = sink();
    await main(['agent', 'list', '--state', state], { stdout: list });
    expect(list.text()).toContain('agent:pos-agent');
    expect(await main(['agent', 'remove', 'pos-agent', '--state', state], { stdout: sink() })).toBe(
      0,
    );
    const after = sink();
    await main(['agent', 'list', '--state', state], { stdout: after });
    expect(after.text()).toContain('No agent connections');
    expect(
      await main(['agent', 'add', 'a', 'b', '--target', 'local_model', '--state', state], {
        stderr: sink(),
      }),
    ).toBe(2);
  });
  it('--token-file writes the token to an owner-only file and prints nothing secret', async () => {
    const state = path.join(dir, 'state');
    const file = path.join(dir, 'secrets', 'agent.token');
    const out = sink();
    expect(
      await main(
        [
          'agent',
          'add',
          'filed',
          '--target',
          'cloud_model',
          '--state',
          state,
          '--token-file',
          file,
        ],
        { stdout: out },
      ),
    ).toBe(0);
    const token = (await readFile(file, 'utf8')).trim();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(out.text()).not.toContain(token);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    const registry = new AgentRegistry(path.join(state, 'agents.yaml'));
    await registry.loadStrict();
    await expect(registry.lookup(token)).resolves.toMatchObject({ name: 'filed' });
  });
  it('refuses a state directory inside a Git working tree or a store, like serve', async () => {
    const repo = path.join(dir, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    for (const argv of [
      ['agent', 'add', 'x', '--target', 'local_model', '--state', path.join(repo, 'state')],
      ['agent', 'list', '--state', path.join(repo, 'state')],
      ['agent', 'remove', 'x', '--state', path.join(repo, 'state')],
    ]) {
      const err = sink();
      expect(await main(argv, { stderr: err })).toBe(1);
      expect(err.text()).toContain('Git working tree');
    }
    const store = path.join(dir, 'store');
    await mkdir(store, { recursive: true });
    const err = sink();
    expect(
      await main(['agent', 'list', '--state', path.join(store, 'state'), '--store', store], {
        stderr: err,
      }),
    ).toBe(1);
    expect(err.text()).toContain('store root');
  });
  it('resolves the per-OS default state directory when --state is absent', async () => {
    const home = path.join(dir, 'xdg');
    const before = process.env['XDG_STATE_HOME'];
    process.env['XDG_STATE_HOME'] = home;
    try {
      if (process.platform === 'linux') {
        expect(
          await main(['agent', 'add', 'dflt', '--target', 'local_model'], { stdout: sink() }),
        ).toBe(0);
        const stored = await readFile(path.join(home, 'worldbuilder', 'agents.yaml'), 'utf8');
        expect(stored).toContain('dflt');
      }
    } finally {
      if (before === undefined) delete process.env['XDG_STATE_HOME'];
      else process.env['XDG_STATE_HOME'] = before;
    }
  });
});

describe('reserved agent names', () => {
  it('refuses a name that a level-1 engine uses, in any letter case', async () => {
    const { addAgent } = await import('./agent-registry.js');
    for (const name of ['local', 'jev', 'Jev', 'LOCAL']) {
      await expect(addAgent(path.join(dir, 'st'), { name, target: 'local_model' })).rejects.toThrow(
        /reserved for a level-1 engine/,
      );
    }
    await expect(
      addAgent(path.join(dir, 'st'), { name: 'my-engine', target: 'local_model' }, undefined, [
        'My-Engine',
      ]),
    ).rejects.toThrow(/reserved/);
    const err = sink();
    expect(
      await main(
        ['agent', 'add', 'jev', '--target', 'cloud_model', '--state', path.join(dir, 'st')],
        {
          stderr: err,
        },
      ),
    ).toBe(1);
    expect(err.text()).toContain('reserved');
    await expect(
      addAgent(path.join(dir, 'st'), { name: 'locally', target: 'local_model' }),
    ).resolves.toHaveProperty('token');
  });
});

describe('--allow-host values', () => {
  it('adds the port, brackets a bare IPv6 address and refuses ambiguous forms', () => {
    expect(normaliseAllowedHost('WB.example.test', 4310)).toBe('wb.example.test:4310');
    expect(normaliseAllowedHost('wb.example.test:8443', 4310)).toBe('wb.example.test:8443');
    expect(normaliseAllowedHost('127.0.0.1', 4310)).toBe('127.0.0.1:4310');
    expect(normaliseAllowedHost('::1', 4310)).toBe('[::1]:4310');
    expect(normaliseAllowedHost('fd00::5', 4310)).toBe('[fd00::5]:4310');
    expect(normaliseAllowedHost('[::1]', 4310)).toBe('[::1]:4310');
    expect(normaliseAllowedHost('[fd00::5]:9000', 4310)).toBe('[fd00::5]:9000');
    for (const bad of [
      '',
      ':80',
      'name:',
      'name:abc',
      'name:70000',
      'fd00::5:80x',
      '[::1',
      '[1.2.3.4]',
      '[name]:80',
      'a:b:c',
    ])
      expect(() => normaliseAllowedHost(bad, 4310), bad).toThrow(/allow-host|host name/);
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
  it('runs the MCP bridge command: it needs --stdio and a token, never from argv', async () => {
    const err = sink();
    expect(await main(['mcp', '--stdio'], { stderr: err, env: {} })).toBe(2);
    expect(err.text()).toContain('WORLDBUILDER_AGENT_TOKEN_FILE');
    const err2 = sink();
    expect(await main(['mcp'], { stderr: err2, env: { WORLDBUILDER_AGENT_TOKEN: 'x' } })).toBe(2);
    expect(err2.text()).toContain('--stdio');
    const err3 = sink();
    expect(await main(['mcp', '--stdio', '--token', 'abc'], { stderr: err3, env: {} })).toBe(2);
    expect(err3.text()).toContain('not an argument');
    expect(err3.text()).not.toContain('abc');
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
  it('warns loudly when bound beyond loopback, and --allow-host adds Host names (repeatable)', async () => {
    const err = sink();
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
        '--host',
        '0.0.0.0',
        '--allow-host',
        '127.0.0.1',
        '--allow-host',
        `wb.example.test:${port}`,
      ],
      {
        stdout: sink(),
        stderr: err,
        logger: false,
        openStore: async () => new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
        onServe: (s) => {
          service = s;
        },
      },
    );
    try {
      expect(code).toBe(-1);
      expect(err.text()).toContain('WARNING: the service is bound to a network address');
      expect(err.text()).toContain('DNS rebinding');
      const headers = { 'x-worldbuilder-session': service!.sessionToken };
      for (const host of [`127.0.0.1:${port}`, `wb.example.test:${port}`]) {
        const res = await service!.app.inject({
          method: 'GET',
          url: '/worlds',
          headers: { ...headers, host },
        });
        expect(res.statusCode).toBe(200);
      }
      const other = await service!.app.inject({
        method: 'GET',
        url: '/worlds',
        headers: { ...headers, host: `other.example.test:${port}` },
      });
      expect(other.statusCode).toBe(403);
    } finally {
      await service?.close();
    }
  });
  it('does not warn on loopback without --allow-host', async () => {
    const err = sink();
    const port = await freePort();
    let service: Service | undefined;
    await main(
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
        stdout: sink(),
        stderr: err,
        logger: false,
        openStore: async () => new MemoryStorageAdapter(new MemoryStore(crypto.randomUUID())),
        onServe: (s) => {
          service = s;
        },
      },
    );
    try {
      expect(err.text()).toBe('');
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
