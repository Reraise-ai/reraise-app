// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// MCP sessions over Streamable HTTP (ADR-0029). One session per `Mcp-Session-Id`: its own
// server and transport, bound to the key of the caller that opened it. A request that names a
// session of a caller with another key gets the same answer as an unknown session. Every tool
// call runs with the caller of the HTTP request that carries it (the session only remembers the
// latest request's caller, and a request can only reach a session of its own key), so a
// credential that changed since the session opened never acts through the old session. The class
// knows nothing about the web framework (it takes Node requests) nor about the service: the
// caller is an opaque value with a stable key.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer, type ToolOutcome } from './server.js';
import type { ToolName } from './tools.js';

export interface McpSessionsOptions<Caller> {
  /** Runs one tool call for the caller of the request that carries it. */
  readonly invoke: (
    caller: Caller,
    tool: ToolName,
    args: Record<string, unknown>,
  ) => Promise<ToolOutcome>;
  /**
   * A stable key of a caller. It must change whenever what the caller may do changes (its
   * identity, its target class, its credential): a session is only used under the key it opened with.
   */
  readonly keyOf: (caller: Caller) => string;
  readonly version: string;
  /** Open sessions per caller; the least recently used one is closed to make room. */
  readonly maxSessionsPerCaller?: number;
  /** A session without a request for this long is closed (milliseconds). */
  readonly idleTimeoutMs?: number;
}

interface Session<Caller> {
  readonly key: string;
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  /** The caller of the latest request on this session; tool calls run as this caller. */
  caller: Caller;
  lastUsed: number;
  /** Open server-to-client streams: a session with one is in use. */
  streams: number;
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
  private readonly sessions = new Map<string, Session<Caller>>();
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
    session.caller = caller;
    if (req.method === 'GET') {
      // An open stream is activity: the session is not idle while a client listens on it.
      session.streams++;
      res.once('close', () => {
        session.streams--;
        session.lastUsed = Date.now();
      });
    }
    await session.transport.handleRequest(req, res, body);
  }

  private async open(
    req: IncomingMessage,
    res: ServerResponse,
    caller: Caller,
    key: string,
    body: unknown,
  ): Promise<void> {
    this.startSweeper();
    const holder: { session?: Session<Caller>; caller: Caller } = { caller };
    const server = createToolServer({
      invoke: (tool, args) =>
        this.options.invoke(holder.session?.caller ?? holder.caller, tool, args),
      version: this.options.version,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // Plain JSON answers to POST; the GET stream carries server-initiated messages.
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        // Make room and insert in one synchronous step, so parallel initializations cannot
        // all pass the check and exceed the limit.
        this.evictFor(key);
        const session: Session<Caller> = {
          key,
          server,
          transport,
          caller,
          lastUsed: Date.now(),
          streams: 0,
        };
        holder.session = session;
        this.sessions.set(sessionId, session);
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

  private async drop(session: Session<Caller>): Promise<void> {
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
      for (const s of [...this.sessions.values()]) {
        if (s.streams === 0 && s.lastUsed < cutoff) void this.drop(s);
      }
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

  /**
   * End every session whose key is not accepted any more (a connection that was revoked,
   * re-tokened or reclassified), with its open streams.
   */
  async retain(accept: (key: string) => boolean): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].filter((s) => !accept(s.key)).map((s) => this.drop(s)),
    );
  }

  /** End every session (service shutdown). */
  async close(): Promise<void> {
    if (this.sweeper !== undefined) clearInterval(this.sweeper);
    this.sweeper = undefined;
    await Promise.all([...this.sessions.values()].map((s) => this.drop(s)));
  }
}
