// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The stdio bridge (ADR-0029) against a stand-in service: a plain HTTP server that hosts the
// MCP sessions of this package with a stub tool invoker. The bridge relays messages unchanged,
// keeps the Mcp-Session-Id, passes server-initiated messages on, fails clearly when the service
// is down, takes its token from the environment or a file and never writes a file.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ToolListChangedNotificationSchema,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bridgeMain, mcpUrl, resolveToken, runBridge } from './bridge.js';
import { McpSessions } from './sessions.js';
import { MCP_TOOL_NAMES } from './index.js';

// Every call into the file system modules from the code under test is recorded; the real
// functions still run, so the test itself can prepare a token file.
const { fsCalls, recording } = vi.hoisted(() => {
  const calls: { module: string; fn: string; arg: unknown }[] = [];
  const record = (module: string, actual: Record<string, unknown>) => {
    const wrapped = Object.fromEntries(
      Object.entries(actual).map(([key, value]) => [
        key,
        typeof value === 'function'
          ? (...args: unknown[]) => {
              calls.push({ module, fn: key, arg: args[0] });
              return (value as (...a: unknown[]) => unknown)(...args);
            }
          : value,
      ]),
    );
    return { ...wrapped, default: wrapped };
  };
  return { fsCalls: calls, recording: record };
});
vi.mock('node:fs/promises', async (original) =>
  recording('node:fs/promises', await original<Record<string, unknown>>()),
);
vi.mock('node:fs', async (original) =>
  recording('node:fs', await original<Record<string, unknown>>()),
);

const TOKEN = 'synthetic-agent-token-for-tests';

interface Seen {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
}

let server: Server;
let base: string;
let sessions: McpSessions<string>;
const seen: Seen[] = [];
let workDir: string;

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'wb-bridge-'));
  sessions = new McpSessions<string>({
    keyOf: (caller) => caller,
    // a valid answer for the one tool the tests call (the client checks it against the schema)
    invokeFor: () => async () => ({ status: 200, body: { worlds: [] } }),
    version: '0.0.0',
  });
  server = createServer((req, res) => {
    seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers });
    if (req.url === '/health') return void res.writeHead(200).end('{"status":"ok"}');
    if (req.url !== '/mcp') return void res.writeHead(404).end();
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      return void res
        .writeHead(401, { 'content-type': 'application/problem+json' })
        .end('{"type":"x","title":"Missing or unknown credential","status":401}');
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text === '' ? undefined : (JSON.parse(text) as unknown);
      void sessions.handle(req, res, 'agent', body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await sessions.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
});

/** A client transport over two in-memory streams: the host side of the bridge's stdio. */
class StreamClientTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly buffer = new ReadBuffer();
  constructor(
    private readonly toBridge: PassThrough,
    private readonly fromBridge: PassThrough,
  ) {}
  async start(): Promise<void> {
    this.fromBridge.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let m = this.buffer.readMessage(); m !== null; m = this.buffer.readMessage()) {
        this.onmessage?.(m);
      }
    });
    this.fromBridge.on('close', () => this.onclose?.());
  }
  async send(message: JSONRPCMessage): Promise<void> {
    this.toBridge.write(serializeMessage(message));
  }
  async close(): Promise<void> {
    this.toBridge.end();
  }
}

function startBridge(url: string, token: string) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let errText = '';
  const stderr = { write: (t: string) => void (errText += t) };
  const exit = runBridge({ url, token, stdin, stdout, stderr });
  const client = new Client({ name: 'host', version: '0.0.0' });
  return {
    client,
    transport: new StreamClientTransport(stdin, stdout),
    exit,
    stderr: () => errText,
  };
}

describe('the relay', () => {
  it('forwards initialize, tools/list and tools/call unchanged, with the Mcp-Session-Id', async () => {
    seen.length = 0;
    const b = startBridge(base, TOKEN);
    await b.client.connect(b.transport);
    const { tools } = await b.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    const result = await b.client.callTool({ name: 'world_list', arguments: {} });
    expect(result.structuredContent).toEqual({ worlds: [] });

    const posts = seen.filter((r) => r.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(3);
    expect(posts[0]!.headers['mcp-session-id']).toBeUndefined();
    const ids = new Set(posts.slice(1).map((r) => r.headers['mcp-session-id']));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/);
    // every request carried the agent token, the protocol version header was relayed too
    for (const r of seen.filter((x) => x.path === '/mcp')) {
      expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(posts[posts.length - 1]!.headers['mcp-protocol-version']).toMatch(/^\d{4}-\d\d-\d\d$/);
    // the health check is the only call without the token
    expect(seen.find((r) => r.path === '/health')!.headers.authorization).toBeUndefined();

    await b.client.close();
    expect(await b.exit).toBe(0);
    // closing the host side ended the service session as well
    expect(sessions.size).toBe(0);
  });

  it('carries a server-initiated message over the server stream to the host', async () => {
    const b = startBridge(base, TOKEN);
    await b.client.connect(b.transport);
    const changed = new Promise<void>((resolve) => {
      b.client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve());
    });
    // the server stream is opened after the initialized notification
    await vi.waitFor(() => expect(seen.some((r) => r.method === 'GET')).toBe(true));
    await new Promise((r) => setTimeout(r, 100));
    await sessions.notifyToolListChanged();
    await changed;
    await b.client.close();
    await b.exit;
  });

  it('answers a request it cannot deliver with an error, never with silence, and never prints the token', async () => {
    const b = startBridge(base, 'a-token-the-service-does-not-know');
    await expect(b.client.connect(b.transport)).rejects.toThrow(/refused the agent token/);
    expect(b.stderr()).toContain('refused the agent token');
    expect(b.stderr()).not.toContain('a-token-the-service-does-not-know');
    await b.client.close().catch(() => undefined);
    await b.exit;
  });
});

describe('when the service is not running', () => {
  it('says so and exits 1, without starting anything', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let err = '';
    const code = await runBridge({
      url: 'http://127.0.0.1:1', // nothing listens there
      token: TOKEN,
      stdin,
      stdout,
      stderr: { write: (t: string) => void (err += t) },
      healthTimeoutMs: 1000,
    });
    expect(code).toBe(1);
    expect(err).toContain('not reachable');
    expect(err).toContain('worldbuilder serve');
    expect(err).not.toContain(TOKEN);
    expect(stdout.read()).toBeNull(); // nothing on the protocol channel
  });
});

describe('the token', () => {
  it('comes from WORLDBUILDER_AGENT_TOKEN or a token file, exactly one of them', async () => {
    expect(await resolveToken({ WORLDBUILDER_AGENT_TOKEN: ` ${TOKEN}\n` })).toBe(TOKEN);
    const file = path.join(workDir, 'token');
    writeFileSync(file, `${TOKEN}\nignored second line\n`, { mode: 0o600 });
    expect(await resolveToken({ WORLDBUILDER_AGENT_TOKEN_FILE: file })).toBe(TOKEN);
    await expect(
      resolveToken({ WORLDBUILDER_AGENT_TOKEN: 'a', WORLDBUILDER_AGENT_TOKEN_FILE: file }),
    ).rejects.toThrow(/not both/);
    await expect(resolveToken({})).rejects.toThrow(/WORLDBUILDER_AGENT_TOKEN_FILE/);
    await expect(
      resolveToken({ WORLDBUILDER_AGENT_TOKEN_FILE: path.join(workDir, 'missing') }),
    ).rejects.toThrow(/cannot read the token file/);
    writeFileSync(file, '\n');
    await expect(resolveToken({ WORLDBUILDER_AGENT_TOKEN_FILE: file })).rejects.toThrow(
      /no agent token/,
    );
  });

  it('is never an argument: a token option is refused and its value is not echoed', async () => {
    for (const args of [
      ['--stdio', '--token', 'SECRET-VALUE'],
      ['--stdio', '--token=SECRET-VALUE'],
      ['--stdio', '--agent-token', 'SECRET-VALUE'],
    ]) {
      let err = '';
      const code = await bridgeMain(args, {}, { stderr: { write: (t) => void (err += t) } });
      expect(code).toBe(2);
      expect(err).toContain('not an argument');
      expect(err).not.toContain('SECRET-VALUE');
    }
  });

  it('refuses unknown arguments, a missing --stdio and bad service URLs', async () => {
    const run = async (args: string[], env: Record<string, string> = {}) => {
      let err = '';
      const code = await bridgeMain(
        args,
        { WORLDBUILDER_AGENT_TOKEN: TOKEN, ...env },
        {
          stderr: { write: (t) => void (err += t) },
        },
      );
      return { code, err };
    };
    expect((await run(['--stdio', '--bogus'])).code).toBe(2);
    expect((await run(['--stdio', 'extra'])).code).toBe(2);
    expect((await run([])).err).toContain('--stdio');
    expect((await run(['--stdio'], { WORLDBUILDER_URL: 'ftp://127.0.0.1' })).code).toBe(1);
    expect((await run(['--stdio'], { WORLDBUILDER_URL: 'http://user:pw@127.0.0.1:1' })).code).toBe(
      1,
    );
    expect(() => mcpUrl('not a url')).toThrow();
    expect(mcpUrl('http://127.0.0.1:4310/anything').href).toBe('http://127.0.0.1:4310/mcp');
  });
});

describe('what the bridge writes', () => {
  it('no file at all: its only file access is reading the token file (ADR-0029)', async () => {
    const tokenFile = path.join(workDir, 'agent-token');
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
    fsCalls.length = 0;

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let err = '';
    const exit = bridgeMain(
      ['--stdio', '--url', base],
      { WORLDBUILDER_AGENT_TOKEN_FILE: tokenFile },
      { stdin, stdout, stderr: { write: (t) => void (err += t) } },
    );
    const client = new Client({ name: 'host', version: '0.0.0' });
    await client.connect(new StreamClientTransport(stdin, stdout));
    await client.listTools();
    await client.callTool({ name: 'world_list', arguments: {} });
    await client.close();
    expect(await exit).toBe(0);
    expect(err).toBe('');

    // Exactly one call into the file system modules from the bridge: readFile of the token file.
    expect(fsCalls).toEqual([{ module: 'node:fs/promises', fn: 'readFile', arg: tokenFile }]);
  });
});
