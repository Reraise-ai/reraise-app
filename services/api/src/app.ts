// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The Fastify application of the Board API (ADR-0016, ADR-0026, ADR-0029). Routes come from the
// OpenAPI contract: every operation needs a handler and the reverse. The request path is
//   Host/Origin check -> credential -> access rule -> params -> body size and JSON -> body
//   schema -> handler -> response schema -> reply
// and every failure is an RFC 9457 problem. Responses are validated against the contract before
// they leave, so a schema the service violates (for example stance data in a non-screen
// package) is a 500 and never reaches the caller.

import type { LocalStateStore, StorageAdapter } from '@worldbuilder/core';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { AgentRegistry } from './agent-registry.js';
import { safeEqual, sha256Hex, type Principal } from './auth.js';
import { loadOperations, type Operation } from './contract.js';
import { Disclosures } from './disclosure.js';
import { describeError } from './errors.js';
import { executeOperation } from './execute.js';
import { GateService } from './gate.js';
import { Level1EngineRegistry, type Level1EngineRegistryOptions } from './level1-engines.js';
import { Level1Service } from './level1.js';
import { createMcpMount, type McpMount } from './mcp.js';
import { handlers } from './operations.js';
import { ReceiptStore } from './receipts.js';
import { HttpError, problemOf } from './problem.js';
import type { Services } from './services.js';
import { Mutex } from './util.js';

export const DEFAULT_PORT = 4310;
export const DEFAULT_BODY_LIMIT = 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export interface AppOptions {
  readonly storage: StorageAdapter;
  readonly localState: LocalStateStore;
  readonly agents: AgentRegistry;
  /** The human session token; the caller generates it and decides where it is written. */
  readonly sessionToken: string;
  /** Bind host; `127.0.0.1` by default (ADR-0026). */
  readonly host?: string;
  readonly port?: number;
  /** Extra Host header values to accept (self-hosting behind a reverse proxy). */
  readonly allowedHosts?: readonly string[];
  /** How often the agent registry file is looked at for revocations (milliseconds). */
  readonly agentSweepMs?: number;
  /** Origins that may call from a browser, besides the service's own (the board's origin). */
  readonly allowedOrigins?: readonly string[];
  /** Largest accepted request body in bytes; larger bodies get 413. */
  readonly bodyLimit?: number;
  readonly syntheticStores?: readonly string[];
  /** Level 1: an injected `fetch` for cloud engines and a replacement local engine (tests). */
  readonly level1?: Pick<Level1EngineRegistryOptions, 'fetch' | 'localEngine'>;
  readonly logger?: FastifyBaseLogger | boolean | object;
  readonly now?: () => Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/** The service: the Fastify instance plus what the front ends and the CLI need. */
export interface BoardApp extends FastifyInstance {
  /** Accept Host and Origin values for the port the server actually bound (port 0 starts). */
  allowPort(port: number): void;
  readonly services: Services;
  readonly gateService: GateService;
  /** The MCP sessions of the `/mcp` mount (ADR-0029). */
  readonly mcp: McpMount['sessions'];
}

const CORS_HEADERS = {
  'access-control-allow-headers': 'content-type, authorization, x-worldbuilder-session',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-max-age': '600',
} as const;

function bearerOf(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined) return undefined;
  const m = /^Bearer +(\S+)$/i.exec(header);
  if (!m) throw new HttpError(401, 'the Authorization header must be "Bearer <token>"');
  return m[1];
}

export async function buildApp(options: AppOptions): Promise<BoardApp> {
  const operations = loadOperations();
  const known = new Set(operations.map((o) => o.id));
  const missing = operations.filter((o) => !handlers[o.id]).map((o) => o.id);
  const extra = Object.keys(handlers).filter((id) => !known.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `contract and handlers differ: missing handlers [${missing}], handlers without operation [${extra}]`,
    );
  }

  const now = options.now ?? (() => new Date());
  const bindHost = options.host ?? '127.0.0.1';
  const hosts = new Set<string>();
  const origins = new Set<string>();
  const allowPort = (port: number) => {
    const names = LOOPBACK.has(bindHost) ? [...LOOPBACK, bindHost] : [bindHost];
    for (const name of names) {
      const hostname = name === '::1' ? '[::1]' : name;
      hosts.add(`${hostname}:${port}`.toLowerCase());
      origins.add(`http://${hostname}:${port}`.toLowerCase());
    }
  };
  if (options.port !== undefined) allowPort(options.port);
  for (const h of options.allowedHosts ?? []) hosts.add(h.toLowerCase());
  for (const o of options.allowedOrigins ?? []) origins.add(o.toLowerCase());

  const gateService = new GateService({
    storage: options.storage,
    localState: options.localState,
    ...(options.syntheticStores ? { syntheticStores: options.syntheticStores } : {}),
    now,
  });
  const sessionId = sha256Hex(options.sessionToken).slice(0, 32);
  const level1 = new Level1Service(
    () => services,
    new Level1EngineRegistry({
      stateDir: options.localState.stateDir,
      agentNames: () => options.agents.connections.map((c) => c.name),
      ...(options.level1?.fetch ? { fetch: options.level1.fetch } : {}),
      ...(options.level1?.localEngine ? { localEngine: options.level1.localEngine } : {}),
      now,
    }),
  );
  const services: Services = {
    level1,
    storage: options.storage,
    localState: options.localState,
    gate: gateService,
    disclosures: new Disclosures(gateService, options.storage, sessionId, now),
    receipts: new ReceiptStore(options.localState.stateDir, now),
    writes: new Mutex(),
    now,
  };

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? DEFAULT_BODY_LIMIT,
    // One JSON body per request; no query parsing surprises (arrays and nested keys are errors).
    routerOptions: { maxParamLength: 128 },
    // The router rejects an over-long path parameter before any hook runs, with a JSON body that
    // quotes the path. Answer it as a problem, and only to a caller whose Host is allowed.
    frameworkErrors: (error, req, res) => {
      const reply = res as unknown as FastifyReply;
      const host = (req.headers.host ?? '').toLowerCase();
      if (!hosts.has(host)) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problemOf(403, 'the Host header is not allowed', 'host-not-allowed'));
      }
      const tooLong = (error as { code?: string }).code === 'FST_ERR_MAX_PARAM_LENGTH';
      const status = tooLong ? 414 : 400;
      return reply
        .code(status)
        .type('application/problem+json')
        .send(problemOf(status, tooLong ? 'the request path is too long' : 'bad request'));
    },
  }) as unknown as BoardApp;

  // Empty JSON bodies are allowed (accept and reject take an optional body); bad JSON is a 400.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, text, done) => {
    if (text === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text as string));
    } catch {
      done(new HttpError(400, 'the request body is not valid JSON'), undefined);
    }
  });

  const problem = (reply: FastifyReply, status: number, detail?: string, slug?: string) =>
    reply
      .code(status)
      .type('application/problem+json')
      .send(problemOf(status, detail, slug));

  app.setErrorHandler((error, req, reply) => {
    const { status, detail, slug, retryAfter, code } = describeError(error);
    if (retryAfter !== undefined) reply.header('retry-after', String(retryAfter));
    // Rejected requests are logged without their content (ADR-0026).
    if (status >= 500) {
      req.log.error({ err: { type: (error as Error).name, code } }, 'request failed');
    } else req.log.info({ status, code }, 'request rejected');
    return problem(reply, status, detail, slug);
  });
  app.setNotFoundHandler((_req, reply) => problem(reply, 404, 'no such route'));

  // Host and Origin (ADR-0029): defence against DNS rebinding and foreign browser pages.
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) {
      return problem(reply, 403, 'the Host header is not allowed', 'host-not-allowed');
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!origins.has(origin.toLowerCase())) {
        return problem(reply, 403, 'the Origin header is not allowed', 'origin-not-allowed');
      }
      reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
      if (req.method === 'OPTIONS') {
        return reply.code(204).headers(CORS_HEADERS).send();
      }
    }
    return undefined;
  });

  /** The caller of a request: exactly one credential, the session token or a registered agent. */
  const authenticate = async (req: FastifyRequest): Promise<Principal> => {
    const session = req.headers['x-worldbuilder-session'];
    const bearer = bearerOf(req);
    if (session !== undefined && bearer !== undefined) {
      throw new HttpError(401, 'send one credential, not two');
    }
    if (session !== undefined) {
      if (typeof session !== 'string' || !safeEqual(session, options.sessionToken)) {
        throw new HttpError(401, 'unknown session token');
      }
      return { kind: 'human' };
    }
    if (bearer !== undefined) {
      const agent = await options.agents.lookup(bearer);
      if (!agent) throw new HttpError(401, 'unknown or unregistered agent token');
      return agent;
    }
    throw new HttpError(401, 'a credential is required');
  };

  // Authentication comes before body handling, so an unauthenticated caller learns nothing from
  // size limits or parse errors. Only liveness is open (it carries no data).
  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS' || req.url === '/health') return;
    req.principal = await authenticate(req);
  });

  const run = async (op: Operation, req: FastifyRequest, reply: FastifyReply) => {
    const principal = req.principal;
    if (!principal) throw new HttpError(401, 'a credential is required');
    const result = await executeOperation(
      services,
      op,
      principal,
      {
        params: req.params as Record<string, unknown>,
        query: (req.query ?? {}) as Record<string, unknown>,
        body: req.body,
      },
      {
        onContractViolation: (operation, status) =>
          req.log.error({ operation, status }, 'response violates the contract'),
      },
    );
    return reply.code(result.status).type('application/json').send(result.body);
  };

  for (const op of operations) {
    app.route({
      method: op.method.toUpperCase() as 'GET',
      url: op.route,
      handler: (req, reply) => run(op, req, reply),
    });
  }

  // Liveness for the CLI and supervisors; not part of the contract, no data, Host-checked.
  app.get('/health', async () => ({ status: 'ok' }));

  // MCP over Streamable HTTP at /mcp (ADR-0029): the same process, services and credential rules
  // as the routes above. Host and Origin are already checked by the hook for every path, the
  // bearer token by the authentication hook; /mcp takes registered agents only (a human session
  // token is refused). A session belongs to the agent that opened it. The body limit and the JSON
  // parser are the ones of every route, so an oversized message is a 413.
  const mcp = createMcpMount(services, operations, (message, fields) =>
    app.log.error(fields, message),
  );
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (req, reply) => {
      const principal = req.principal;
      if (!principal) throw new HttpError(401, 'a credential is required');
      if (principal.kind !== 'agent') {
        throw new HttpError(403, 'the MCP endpoint is for registered agents only');
      }
      // The SDK transport writes the response itself (also long-lived streams).
      reply.hijack();
      try {
        await mcp.sessions.handle(req.raw, reply.raw, principal, req.body);
      } catch (error) {
        req.log.error({ err: { type: (error as Error).name } }, 'mcp request failed');
        if (!reply.raw.headersSent) {
          reply.raw
            .writeHead(500, { 'content-type': 'application/problem+json' })
            .end(JSON.stringify(problemOf(500)));
        } else reply.raw.end();
      }
    },
  });
  // A revoked, re-tokened or reclassified connection loses its sessions and streams as soon as
  // the registry notices (it re-reads agents.yaml when the file changes, on a timer too, so a
  // revocation does not wait for the next request of the agent).
  options.agents.subscribe((live) => {
    void mcp.sessions.retain((key) => live.has(key));
  });
  const sweep = setInterval(() => {
    void options.agents.poll().catch(() => undefined);
  }, options.agentSweepMs ?? 2000);
  sweep.unref();
  // Close the sessions (and their streams) before the server stops accepting connections.
  app.addHook('preClose', async () => {
    clearInterval(sweep);
    await mcp.sessions.close();
  });

  app.allowPort = allowPort;
  (app as { services: Services }).services = services;
  (app as { gateService: GateService }).gateService = gateService;
  (app as { mcp: McpMount['sessions'] }).mcp = mcp.sessions;
  await app.ready();
  return app;
}
