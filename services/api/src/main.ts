// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The `worldbuilder` command (ADR-0029), as a function so tests can run it; `cli.ts` is the bin:
//   worldbuilder serve --store <path> [--state <path>] [--port <n>] [--host <h>]
//                      [--allow-host <h>]... [--allow-origin <o>]...
//   worldbuilder agent add <name> --target local_model|cloud_model [--state <path>]
//   worldbuilder mcp --stdio [--url <service URL>]   (the stateless stdio bridge, ADR-0029)

import { bridgeMain, type BridgeMainIo } from '@worldbuilder/mcp-server';
import { assertStateDirSafe, resolveStateDir } from '@worldbuilder/local-state';
import { isIP } from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { addAgent, listAgents, removeAgent } from './agent-registry.js';
import { configuredEngineIds } from './level1-engines.js';
import { writePrivateFile, type AgentTarget } from './auth.js';
import { DEFAULT_PORT } from './app.js';
import type { StorageAdapter } from '@worldbuilder/core';
import { modelOptionsFromEnv } from './models.js';
import { sourceOptionsFromEnv } from './sources.js';
import { createService, type Service } from './service.js';
import { openMarkdownStore } from './store.js';

const USAGE = `Usage:
  worldbuilder serve --store <path> [--state <path>] [--port <n>] [--host <h>]
                     [--allow-host <host>]... [--allow-origin <origin>]...
                     [--rate-limit <requests per minute>] [--auth-failure-limit <n per minute>]
  worldbuilder agent add <name> --target local_model|cloud_model [--state <path>] [--store <path>]
                         [--token-file <path>]
  worldbuilder agent list [--state <path>] [--store <path>]
  worldbuilder agent remove <name> [--state <path>] [--store <path>]
  (the agent name may also be given as --name <name>)
  worldbuilder mcp --stdio [--url <service URL>]
                         (token from WORLDBUILDER_AGENT_TOKEN_FILE or WORLDBUILDER_AGENT_TOKEN;
                          service URL from --url or WORLDBUILDER_URL, default http://127.0.0.1:4310)
`;

class UsageError extends Error {}

/** What tests replace: the store opener, the output streams and the serve hook. */
export interface MainDeps {
  readonly openStore?: (root: string) => Promise<StorageAdapter>;
  readonly stdout?: { write(text: string): unknown };
  readonly stderr?: { write(text: string): unknown };
  /** Called with the running service instead of installing signal handlers (tests). */
  readonly onServe?: (service: Service) => void;
  /** Replaces the request logger of `serve` (tests turn it off). */
  readonly logger?: boolean | object;
  /** The environment the stdio bridge reads its token and service URL from. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Streams and fetch of the stdio bridge (tests). */
  readonly bridge?: Pick<BridgeMainIo, 'stdin' | 'stdout' | 'fetch' | 'readFile'>;
}

const isLoopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);

function absolute(p: string): string {
  return path.resolve(p);
}

/**
 * A Host header value as the service compares it: `name` becomes `name:<port>`, a bare IPv6
 * address is put in brackets (`::1` becomes `[::1]:<port>`), and `[addr]:port`, `name:port` are
 * kept. Anything else (a lone colon, an unbracketed address with a port, a bad port) is refused.
 */
export function normaliseAllowedHost(host: string, port: number): string {
  const h = host.trim().toLowerCase();
  const bad = () => new UsageError(`--allow-host ${host}: not a host name or address`);
  if (h === '') throw new UsageError('--allow-host needs a host name');
  const validPort = (p: string) => /^\d{1,5}$/.test(p) && Number(p) >= 1 && Number(p) <= 65535;
  if (h.startsWith('[')) {
    const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(h);
    if (!m || !isIP(m[1]!) || isIP(m[1]!) !== 6) throw bad();
    if (m[2] !== undefined && !validPort(m[2])) throw bad();
    return `[${m[1]}]:${m[2] ?? port}`;
  }
  if (isIP(h) === 6) return `[${h}]:${port}`;
  const colons = h.split(':').length - 1;
  if (colons === 0) return `${h}:${port}`;
  if (colons > 1) throw bad(); // an IPv6 address with a port must be in brackets
  const [name, p] = h.split(':') as [string, string];
  if (name === '' || !validPort(p)) throw bad();
  return h;
}

async function serve(argv: string[], deps: MainDeps): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      store: { type: 'string' },
      state: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'allow-host': { type: 'string', multiple: true },
      'allow-origin': { type: 'string', multiple: true },
      'rate-limit': { type: 'string' },
      'auth-failure-limit': { type: 'string' },
    },
    strict: true,
  });
  if (!values.store) throw new UsageError('--store <path> is required');
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError('--port must be an integer from 1 to 65535');
  }
  const positive = (flag: 'rate-limit' | 'auth-failure-limit'): number | undefined => {
    const raw = values[flag];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      throw new UsageError(`--${flag} must be an integer from 1 to 1000000`);
    }
    return n;
  };
  const max = positive('rate-limit');
  const authFailureMax = positive('auth-failure-limit');
  const host = values.host ?? '127.0.0.1';
  const allowedHosts = (values['allow-host'] ?? []).map((h) => normaliseAllowedHost(h, port));
  const storeRoot = absolute(values.store);
  const storage = await (deps.openStore ?? openMarkdownStore)(storeRoot);
  const service = await createService({
    storage,
    storeRoots: [storeRoot],
    ...(values.state ? { stateDir: absolute(values.state) } : {}),
    host,
    port,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    ...(values['allow-origin'] ? { allowedOrigins: values['allow-origin'] } : {}),
    ...(max !== undefined || authFailureMax !== undefined
      ? {
          rateLimit: {
            ...(max !== undefined ? { max } : {}),
            ...(authFailureMax !== undefined ? { authFailureMax } : {}),
          },
        }
      : {}),
    seedDefaultGateRules: true,
    models: modelOptionsFromEnv(deps.env ?? process.env),
    sources: sourceOptionsFromEnv(deps.env ?? process.env),
    logger: deps.logger ?? {
      level: 'info',
      redact: ['req.headers.authorization', 'req.headers["x-worldbuilder-session"]'],
      serializers: {
        // Method and path only: query strings can carry search text.
        req: (r: { method: string; url: string }) => ({
          method: r.method,
          url: r.url.split('?')[0],
        }),
      },
    },
  });
  const bound = await service.listen();
  const out = deps.stdout ?? process.stdout;
  const err = deps.stderr ?? process.stderr;
  out.write(`The Worldbuilder is listening on http://${bound.host}:${bound.port}\n`);
  if (!isLoopback(host)) {
    err.write(
      '\n' +
        '!!! WARNING: the service is bound to a network address, not to loopback. !!!\n' +
        `Anyone who can reach ${host}:${bound.port} can try to guess tokens and read what the gate\n` +
        'allows. Put your own access control (VPN, or a reverse proxy with authentication and TLS)\n' +
        'in front of it, and never expose it to the internet as it is.\n\n',
    );
  }
  if (allowedHosts.length > 0) {
    err.write(
      `WARNING: also accepting Host header(s) ${allowedHosts.join(', ')}. A name that points at this\n` +
        'machine from outside re-opens the door to DNS rebinding; allow only names you control.\n',
    );
  }
  out.write(`State directory:  ${service.stateDir}\n`);
  out.write(
    `Session token (shown once, also in ${service.sessionTokenFile}):\n${service.sessionToken}\n`,
  );
  out.write(
    `Agent connections: worldbuilder agent add --name <name> --target local_model|cloud_model\n`,
  );
  if (deps.onServe) {
    deps.onServe(service);
    return;
  }
  const stop = () => {
    void service.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function agent(argv: string[], deps: MainDeps): Promise<void> {
  const [sub, ...rest] = argv;
  const out = deps.stdout ?? process.stdout;
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      target: { type: 'string' },
      state: { type: 'string' },
      store: { type: 'string', multiple: true },
      'token-file': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  // The same directory rules as `serve` (ADR-0030): the per-OS default or an explicit absolute
  // path, never inside a store or a Git working tree, symbolic links followed.
  const stateDir = await assertStateDirSafe(
    values.state ? absolute(values.state) : resolveStateDir(),
    { storeRoots: (values.store ?? []).map(absolute) },
  );
  const name = values.name ?? positionals[0];
  if (positionals.length > (values.name === undefined ? 1 : 0)) {
    throw new UsageError('too many arguments');
  }
  if (sub === 'list') {
    if (name !== undefined) throw new UsageError('agent list takes no name');
    const agents = await listAgents(stateDir);
    for (const a of agents.filter((x) => x.revokedAt === undefined)) {
      out.write(`agent:${a.name}\t${a.target}\t${a.createdAt}\n`);
    }
    if (!agents.some((x) => x.revokedAt === undefined)) {
      out.write('No agent connections registered.\n');
    }
    return;
  }
  if (sub === 'remove') {
    if (!name) throw new UsageError('the agent name is required');
    await removeAgent(stateDir, name);
    out.write(`Removed agent:${name}. Its token no longer works.\n`);
    return;
  }
  if (sub !== 'add') throw new UsageError('expected: agent add|list|remove');
  if (!name) throw new UsageError('the agent name is required');
  if (values.target !== 'local_model' && values.target !== 'cloud_model') {
    throw new UsageError('--target must be local_model or cloud_model');
  }
  const { token } = await addAgent(
    stateDir,
    { name, target: values.target as AgentTarget },
    undefined,
    await configuredEngineIds(stateDir),
  );
  out.write(`Registered agent:${name} as ${values.target}.\n`);
  if (values['token-file'] !== undefined) {
    // For scripts and agent configurations: the token goes to an owner-only file (the agent
    // reads it from WORLDBUILDER_AGENT_TOKEN_FILE, ADR-0037) and is never printed.
    await writePrivateFile(absolute(values['token-file']), `${token}\n`);
    out.write(`Token written to ${absolute(values['token-file'])} (owner-only). Not shown.\n`);
    return;
  }
  out.write(`Token (shown once; only its hash is stored):\n${token}\n`);
}

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'serve':
        await serve(rest, deps);
        return -1; // keep running
      case 'agent':
        await agent(rest, deps);
        return 0;
      case 'mcp':
        // stdout belongs to the protocol: every message of the bridge itself goes to stderr.
        return await bridgeMain(rest, deps.env ?? process.env, {
          ...deps.bridge,
          ...(deps.stderr ? { stderr: deps.stderr } : {}),
        });
      default:
        throw new UsageError('expected one of: serve, agent, mcp');
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = deps.stderr ?? process.stderr;
    err.write(`worldbuilder: ${message}\n`);
    if (e instanceof UsageError) err.write(USAGE);
    return e instanceof UsageError ? 2 : 1;
  }
}
