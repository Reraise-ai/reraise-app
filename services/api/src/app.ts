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

import { isStorageError, type LocalStateStore, type StorageAdapter } from '@worldbuilder/core';
import { isLocalStateError } from '@worldbuilder/local-state';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { AgentRegistry } from './agent-registry.js';
import { safeEqual, sha256Hex, type Principal } from './auth.js';
import { loadOperations, validators, type Operation } from './contract.js';
import { Disclosures } from './disclosure.js';
import { GateService } from './gate.js';
import { handlers } from './operations.js';
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
  /** Origins that may call from a browser, besides the service's own (the board's origin). */
  readonly allowedOrigins?: readonly string[];
  /** Largest accepted request body in bytes; larger bodies get 413. */
  readonly bodyLimit?: number;
  readonly syntheticStores?: readonly string[];
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
}

const STORAGE_STATUS = { not_found: 404, conflict: 409, invalid: 400, locked: 503 } as const;
const STORAGE_DETAIL = {
  not_found: 'the store has no such card',
  conflict: 'the store holds a different state than this change was based on',
  invalid: 'the store rejected the card or the query as invalid',
  locked: 'the store is busy; try again shortly',
} as const;

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
  const services: Services = {
    storage: options.storage,
    localState: options.localState,
    gate: gateService,
    disclosures: new Disclosures(gateService, options.storage, sessionId, now),
    writes: new Mutex(),
    now,
  };

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? DEFAULT_BODY_LIMIT,
    // One JSON body per request; no query parsing surprises (arrays and nested keys are errors).
    routerOptions: { maxParamLength: 128 },
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
    const e = error as Error & { statusCode?: number; code?: string };
    const errorCode = e.code;
    let status = 500;
    let detail: string | undefined;
    if (e instanceof HttpError) {
      status = e.status;
      detail = e.detail;
    } else if (isLocalStateError(e)) {
      const code: string = e.code;
      status =
        code === 'invalid' ? 400 : code === 'not_found' ? 404 : code === 'conflict' ? 409 : 500;
      detail = status === 500 ? undefined : e.message;
    } else if (isStorageError(e)) {
      // The adapter's typed failures (ADR-0005). The detail is fixed wording plus the adapter's
      // own stable reason code: an adapter message could quote card text, so it is not sent.
      status = STORAGE_STATUS[e.code];
      detail = STORAGE_DETAIL[e.code];
      const reason = (e as { reason?: unknown }).reason;
      if (typeof reason === 'string' && /^[a-z_]{1,40}$/.test(reason)) detail += ` (${reason})`;
      if (status === 503) reply.header('retry-after', '1');
    } else if (errorCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      status = 413;
      detail = 'the request body exceeds the size limit';
    } else if (errorCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      status = 415;
      detail = 'the request body must be application/json';
    } else if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      status = e.statusCode;
      detail = 'the request could not be processed';
    }
    // Rejected requests are logged without their content (ADR-0026).
    if (status >= 500) req.log.error({ err: { type: e.name, code: errorCode } }, 'request failed');
    else req.log.info({ status, code: errorCode }, 'request rejected');
    return problem(reply, status, detail);
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
    if (op.access === 'human' && principal.kind !== 'human') {
      throw new HttpError(403, 'this operation is for the human session only', 'human-only');
    }
    if (op.access === 'agent' && principal.kind !== 'agent') {
      throw new HttpError(403, 'this operation is for registered agents only');
    }

    // Parameters: unknown query names are rejected; invalid values are a 400 (or a 404 for an
    // operation that declares no 400, as the id then simply does not exist).
    const invalidStatus = op.responses.has(400) ? 400 : 404;
    const params: Record<string, unknown> = {};
    const query: Record<string, unknown> = {};
    const declared = new Set(op.params.filter((p) => p.in === 'query').map((p) => p.name));
    for (const name of Object.keys((req.query ?? {}) as Record<string, unknown>)) {
      if (!declared.has(name)) throw new HttpError(400, `unknown query parameter ${name}`);
    }
    for (const p of op.params) {
      const raw =
        p.in === 'path'
          ? (req.params as Record<string, unknown>)[p.name]
          : (req.query as Record<string, unknown>)[p.name];
      if (raw === undefined) {
        if (p.required) throw new HttpError(invalidStatus, `missing parameter ${p.name}`);
        continue;
      }
      const checked = validators.coerced(p.schemaRef)(raw);
      if (!checked.ok) {
        throw new HttpError(invalidStatus, `invalid parameter ${p.name}: ${checked.message}`);
      }
      (p.in === 'path' ? params : query)[p.name] = checked.value;
    }

    let body: unknown = undefined;
    if (op.hasBody) {
      body = req.body;
      if (body === undefined) {
        if (op.bodyRequired) throw new HttpError(400, 'a request body is required');
        body = {};
      }
      if (op.bodySchemaRef) {
        const checked = validators.strict(op.bodySchemaRef)(body);
        if (!checked.ok) throw new HttpError(400, `invalid request: ${checked.message}`);
      }
    }

    const result = await handlers[op.id]!(services, { principal, params, query, body });

    const declaredResponse = op.responses.get(result.status);
    if (declaredResponse?.schemaRef) {
      const checked = validators.strict(declaredResponse.schemaRef)(result.body);
      if (!checked.ok) {
        // A service bug: never send a body the contract does not allow.
        req.log.error(
          { operation: op.id, status: result.status },
          'response violates the contract',
        );
        throw new HttpError(500, 'the response did not match the contract');
      }
    }
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

  // MCP seam: the next slice mounts the MCP server at /mcp here. It must use `services` and the
  // same `authenticate` rules (agent bearer token only), so both front ends share one gate,
  // one adapter and one proposal list (ADR-0029). Host and Origin are already checked by the
  // hook above for every path.

  app.allowPort = allowPort;
  (app as { services: Services }).services = services;
  (app as { gateService: GateService }).gateService = gateService;
  await app.ready();
  return app;
}
