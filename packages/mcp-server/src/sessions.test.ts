// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Session bookkeeping of the MCP mount: ownership, limits per caller, idle expiry, shutdown.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpSessions } from './sessions.js';

let server: Server;
let base: string;
let sessions: McpSessions<string>;

async function start(options: { max?: number; idleMs?: number } = {}) {
  sessions = new McpSessions<string>({
    keyOf: (c) => c,
    invokeFor: () => async () => ({ status: 200, body: { worlds: [] } }),
    version: '0.0.0',
    ...(options.max !== undefined ? { maxSessionsPerCaller: options.max } : {}),
    ...(options.idleMs !== undefined ? { idleTimeoutMs: options.idleMs } : {}),
  });
  server = createServer((req, res) => {
    const caller = String(req.headers['x-caller'] ?? 'a');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      void sessions.handle(req, res, caller, text === '' ? undefined : JSON.parse(text));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
const initialize = (id = 1) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    },
  });
const open = async (caller: string) => {
  const res = await fetch(base, {
    method: 'POST',
    headers: { ...HEADERS, 'x-caller': caller },
    body: initialize(),
  });
  return { status: res.status, id: res.headers.get('mcp-session-id') };
};

afterEach(async () => {
  vi.useRealTimers();
  await sessions.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('McpSessions', () => {
  beforeEach(async () => {
    await start({ max: 2 });
  });

  it('keeps at most N sessions per caller and closes the least recently used', async () => {
    const first = await open('a');
    const second = await open('a');
    const other = await open('b');
    expect(sessions.size).toBe(3);
    // use the first so the second is the least recently used
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(
      (
        await fetch(base, {
          method: 'POST',
          headers: { ...HEADERS, 'x-caller': 'a', 'mcp-session-id': first.id! },
          body: list,
        })
      ).status,
    ).toBe(200);
    const third = await open('a');
    expect(third.status).toBe(200);
    await vi.waitFor(() => expect(sessions.size).toBe(3));
    const probe = (caller: string, id: string) =>
      fetch(base, {
        method: 'POST',
        headers: { ...HEADERS, 'x-caller': caller, 'mcp-session-id': id },
        body: list,
      }).then((r) => r.status);
    expect(await probe('a', second.id!)).toBe(404);
    expect(await probe('a', first.id!)).toBe(200);
    expect(await probe('a', third.id!)).toBe(200);
    expect(await probe('b', other.id!)).toBe(200);
  });

  it('closeCaller ends the sessions of one caller only; close ends all', async () => {
    await open('a');
    await open('b');
    await sessions.closeCaller('a');
    expect(sessions.size).toBe(1);
    await sessions.close();
    expect(sessions.size).toBe(0);
  });

  it('refuses a batched initialize, a GET without a session and a DELETE of an unknown one', async () => {
    const batched = await fetch(base, {
      method: 'POST',
      headers: HEADERS,
      body: `[${initialize(1)},${initialize(2)}]`,
    });
    expect(batched.status).toBe(400);
    expect(
      (await fetch(base, { method: 'GET', headers: { accept: 'text/event-stream' } })).status,
    ).toBe(400);
    expect(
      (await fetch(base, { method: 'DELETE', headers: { 'mcp-session-id': 'nope' } })).status,
    ).toBe(404);
    expect(sessions.size).toBe(0);
  });
});

describe('idle expiry', () => {
  it('closes a session that was not used for the idle timeout', async () => {
    await start({ idleMs: 1500 });
    const s = await open('a');
    expect(sessions.size).toBe(1);
    await vi.waitFor(() => expect(sessions.size).toBe(0), { timeout: 8000, interval: 200 });
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const res = await fetch(base, {
      method: 'POST',
      headers: { ...HEADERS, 'x-caller': 'a', 'mcp-session-id': s.id! },
      body: list,
    });
    expect(res.status).toBe(404);
  }, 15000);
});
