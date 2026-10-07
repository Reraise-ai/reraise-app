// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// `worldbuilder mcp --stdio` as a child process (ADR-0029): an MCP host starts the bridge, the
// bridge relays to the running service's /mcp. The same call through the bridge and directly
// over /mcp returns the same result; with the service down the bridge fails with a clear error.
// The bridge module is compiled on the fly into the package's own node_modules (so it finds the
// SDK), because the tests run before any build.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_TOOL_NAMES } from '@worldbuilder/mcp-server';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixture, type Fixture } from './test-helpers.js';

const pkgDir = fileURLToPath(new URL('../../../packages/mcp-server/', import.meta.url));
let f: Fixture;
let buildDir: string;
let entry: string;
let tokenFile: string;

beforeAll(async () => {
  f = await makeFixture({ listen: true });
  mkdirSync(path.join(pkgDir, 'node_modules'), { recursive: true });
  buildDir = mkdtempSync(path.join(pkgDir, 'node_modules', '.bridge-test-'));
  const source = readFileSync(path.join(pkgDir, 'src/bridge.ts'), 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
  });
  writeFileSync(path.join(buildDir, 'bridge.js'), out.outputText);
  writeFileSync(path.join(buildDir, 'package.json'), '{"type":"module"}');
  entry = path.join(buildDir, 'main.js');
  writeFileSync(
    entry,
    "import { bridgeMain } from './bridge.js';\n" +
      'process.exit(await bridgeMain(process.argv.slice(2), process.env));\n',
  );
  tokenFile = path.join(buildDir, 'token');
  writeFileSync(tokenFile, `${f.tokens['scripted']}\n`, { mode: 0o600 });
});

afterAll(async () => {
  rmSync(buildDir, { recursive: true, force: true });
  await f.close();
});

describe('worldbuilder mcp --stdio as a child process', () => {
  it('relays a host session to /mcp: same tools, same results as a direct connection', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, '--stdio'],
      env: { WORLDBUILDER_AGENT_TOKEN_FILE: tokenFile, WORLDBUILDER_URL: f.url },
      stderr: 'pipe',
    });
    const viaBridge = new Client({ name: 'host', version: '0.0.0' });
    await viaBridge.connect(transport);

    const direct = new Client({ name: 'direct', version: '0.0.0' });
    await direct.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', f.url), {
        requestInit: { headers: { authorization: `Bearer ${f.tokens['scripted']}` } },
      }),
    );

    const tools = await viaBridge.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(tools).toEqual(await direct.listTools());

    const args = { worldId: f.worldId, text: 'claim' };
    const a = await viaBridge.callTool({ name: 'cards_search', arguments: args });
    const b = await direct.callTool({ name: 'cards_search', arguments: args });
    expect(a.isError).toBeFalsy();
    expect(a).toEqual(b);

    // a write through the bridge is attributed to the registered agent of the token
    const created = await viaBridge.callTool({
      name: 'proposal_create',
      arguments: { kind: 'comment', payload: { cardId: f.ids.evPublic, text: 'Via the bridge.' } },
    });
    expect(created.isError).toBeFalsy();
    expect((created.structuredContent as { author: string }).author).toBe('agent:scripted');

    // a tool error comes through as a tool error
    const refused = await viaBridge.callTool({
      name: 'card_get',
      arguments: { cardId: f.ids.evPrivate },
    });
    expect(refused.isError).toBe(true);

    expect(f.service.app.mcp.size).toBeGreaterThanOrEqual(2);
    await viaBridge.close();
    await direct.close();
    // the bridge ended its service session when the host went away
    await new Promise((r) => setTimeout(r, 300));
  });

  it('never sees the token on its command line, and stdout carries protocol messages only', async () => {
    const child = spawn(process.execPath, [entry, '--stdio'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        WORLDBUILDER_AGENT_TOKEN_FILE: tokenFile,
        WORLDBUILDER_URL: f.url,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(child.spawnargs.join(' ')).not.toContain(f.tokens['scripted']!);
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw', version: '0' },
        },
      }) + '\n',
    );
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (out.includes('\n')) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
    child.stdin.end();
    const code = await new Promise((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);
    for (const line of out.split('\n').filter((l) => l !== '')) {
      const message = JSON.parse(line) as { jsonrpc: string };
      expect(message.jsonrpc).toBe('2.0');
    }
    expect(out).not.toContain(f.tokens['scripted']!);
  });

  it('fails clearly when the service is not running, and when no token is configured', async () => {
    const run = (env: Record<string, string>) =>
      new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
        const child = spawn(process.execPath, [entry, '--stdio'], {
          env: { PATH: process.env['PATH'] ?? '', ...env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stderr = '';
        let stdout = '';
        child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
        child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
        child.on('exit', (code) => resolve({ code, stderr, stdout }));
      });
    const down = await run({
      WORLDBUILDER_AGENT_TOKEN_FILE: tokenFile,
      WORLDBUILDER_URL: 'http://127.0.0.1:1',
    });
    expect(down.code).toBe(1);
    expect(down.stderr).toContain('not reachable');
    expect(down.stderr).toContain('worldbuilder serve');
    expect(down.stdout).toBe('');
    const noToken = await run({ WORLDBUILDER_URL: f.url });
    expect(noToken.code).toBe(2);
    expect(noToken.stderr).toContain('WORLDBUILDER_AGENT_TOKEN_FILE');
    expect(noToken.stdout).toBe('');
  });
});
