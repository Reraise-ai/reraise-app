// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// MCP sessions over Streamable HTTP (ADR-0029). One session per `Mcp-Session-Id`: its own
// server and transport, bound to the caller that opened it. A request that names a session of
// another caller gets the same answer as an unknown session. The class knows nothing about the
// web framework (it takes Node requests) and nothing about the service: the caller is an opaque
// value with a stable key, and tool calls go through the injected invoker.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer, type ToolInvoker } from './server.js';

export interface McpSessionsOptions<Caller> {
  /** The invoker of one caller's tool calls. */
  readonly invokeFor: (caller: Caller) => ToolInvoker;
  /** A stable key of a caller: a session is only ever used by the caller that opened it. */
  readonly keyOf: (caller: Caller) => string;
  readonly version: string;
  /** Open sessions per caller; the least recently used one is closed to make room. */
  readonly maxSessionsPerCaller?: number;
  /** A session without a request for this long is closed (milliseconds). */
  readonly idleTimeoutMs?: number;
}

interface Session {
  readonly key: string;
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  lastUsed: number;
}

export const DEFAULT_MAX_SESSIONS_PER_CALLER = 16;
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const rpcError = (res: ServerResponse, status: number, code: number, message: string) => {
  if (res.headersSent) return;
  res
    .writeHead(status, { 'content-type': 'application/json' })
    .end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
};

export class McpSessions<Caller> {
  private readonly sessions = new Map<string, Session>();
  private readonly max: number;
  private readonly idleMs: number;
  private sweeper: NodeJS.Timeout | undefined;

  constructor(private readonly options: McpSessionsOptions<Caller>) {
    this.max = options.maxSessionsPerCaller ?? DEFAULT_MAX_SESSIONS_PER_CALLER;
    this.idleMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  get size(): number {
    return this.sessions.size;
  }

  /**
   * Serve one HTTP request of an authenticated caller: POST (messages), GET (the server-to-
   * client stream) or DELETE (end of session). `body` is the parsed JSON body of a POST.
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    caller: Caller,
    body?: unknown,
  ): Promise<void> {
    const key = this.options.keyOf(caller);
    const header = req.headers['mcp-session-id'];
    const id = Array.isArray(header) ? header[0] : header;

    if (id === undefined) {
      const messages = Array.isArray(body) ? body : [body];
      if (req.method !== 'POST' || !messages.some((m) => isInitializeRequest(m))) {
        return rpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
      }
      if (messages.length !== 1) {
        return rpcError(res, 400, -32600, 'Bad Request: initialize must not be batched');
      }
      return this.open(req, res, caller, key, body);
    }

    const session = this.sessions.get(id);
    if (session === undefined || session.key !== key) {
      // Another caller's session answers exactly like one that does not exist.
      return rpcError(res, 404, -32001, 'Session not found');
    }
    session.lastUsed = Date.now();
    await session.transport.handleRequest(req, res, body);
  }

  private async open(
    req: IncomingMessage,
    res: ServerResponse,
    caller: Caller,
    key: string,
    body: unknown,
  ): Promise<void> {
    this.evictFor(key);
    this.startSweeper();
    const server = createToolServer({
      invoke: this.options.invokeFor(caller),
      version: this.options.version,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // Plain JSON answers to POST; the GET stream carries server-initiated messages.
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, { key, server, transport, lastUsed: Date.now() });
      },
    });
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId !== undefined) this.sessions.delete(sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    if (transport.sessionId === undefined) {
      // The initialize request was refused (for example an unsupported protocol version).
      await server.close();
    }
  }

  /** Make room for one more session of this caller. */
  private evictFor(key: string): void {
    const mine = [...this.sessions.values()].filter((s) => s.key === key);
    if (mine.length < this.max) return;
    mine.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const s of mine.slice(0, mine.length - this.max + 1)) void this.drop(s);
  }

  private async drop(session: Session): Promise<void> {
    if (session.transport.sessionId !== undefined) {
      this.sessions.delete(session.transport.sessionId);
    }
    await session.server.close().catch(() => undefined);
  }

  private startSweeper(): void {
    if (this.sweeper !== undefined || this.idleMs <= 0) return;
    const every = Math.max(1000, Math.min(this.idleMs / 2, 60_000));
    this.sweeper = setInterval(() => {
      const cutoff = Date.now() - this.idleMs;
      for (const s of [...this.sessions.values()]) if (s.lastUsed < cutoff) void this.drop(s);
    }, every);
    this.sweeper.unref();
  }

  /** Tell every open session that the tool list may have changed (also a live test hook). */
  async notifyToolListChanged(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((s) =>
        s.server.server.sendToolListChanged().catch(() => undefined),
      ),
    );
  }

  /** End every session of a caller, for example after its token was revoked. */
  async closeCaller(key: string): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].filter((s) => s.key === key).map((s) => this.drop(s)),
    );
  }

  /** End every session (service shutdown). */
  async close(): Promise<void> {
    if (this.sweeper !== undefined) clearInterval(this.sweeper);
    this.sweeper = undefined;
    await Promise.all([...this.sessions.values()].map((s) => this.drop(s)));
  }
}
