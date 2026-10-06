// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The `worldbuilder` command (ADR-0029), as a function so tests can run it; `cli.ts` is the bin:
//   worldbuilder serve --store <path> [--state <path>] [--port <n>] [--host <h>] [--allow-origin <o>]
//   worldbuilder agent add --name <name> --target local_model|cloud_model [--state <path>]
//   worldbuilder mcp --stdio            (next slice: the stateless stdio bridge)

import { resolveStateDir } from '@worldbuilder/local-state';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { addAgent, listAgents, removeAgent } from './agent-registry.js';
import type { AgentTarget } from './auth.js';
import { DEFAULT_PORT } from './app.js';
import type { StorageAdapter } from '@worldbuilder/core';
import { createService, type Service } from './service.js';
import { openMarkdownStore } from './store.js';

const USAGE = `Usage:
  worldbuilder serve --store <path> [--state <path>] [--port <n>] [--host <h>]
                     [--allow-origin <origin>]...
  worldbuilder agent add --name <name> --target local_model|cloud_model [--state <path>]
  worldbuilder agent list [--state <path>]
  worldbuilder agent remove --name <name> [--state <path>]
  worldbuilder mcp --stdio
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
}

const isLoopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);

function absolute(p: string): string {
  return path.resolve(p);
}

async function serve(argv: string[], deps: MainDeps): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      store: { type: 'string' },
      state: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'allow-origin': { type: 'string', multiple: true },
    },
    strict: true,
  });
  if (!values.store) throw new UsageError('--store <path> is required');
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError('--port must be an integer from 1 to 65535');
  }
  const host = values.host ?? '127.0.0.1';
  const storeRoot = absolute(values.store);
  const storage = await (deps.openStore ?? openMarkdownStore)(storeRoot);
  const service = await createService({
    storage,
    storeRoots: [storeRoot],
    ...(values.state ? { stateDir: absolute(values.state) } : {}),
    host,
    port,
    ...(values['allow-origin'] ? { allowedOrigins: values['allow-origin'] } : {}),
    seedDefaultGateRules: true,
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
      'WARNING: the service is not bound to loopback. Put your own access control (VPN, reverse\n' +
        'proxy with authentication) in front of it.\n',
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
  const options = {
    name: { type: 'string' },
    target: { type: 'string' },
    state: { type: 'string' },
  } as const;
  const { values } = parseArgs({ args: rest, options, strict: true });
  const stateDir = values.state ? absolute(values.state) : resolveStateDir();
  if (sub === 'list') {
    const agents = await listAgents(stateDir);
    for (const a of agents) out.write(`agent:${a.name}\t${a.target}\n`);
    if (agents.length === 0) out.write('No agent connections registered.\n');
    return;
  }
  if (sub === 'remove') {
    if (!values.name) throw new UsageError('--name is required');
    await removeAgent(stateDir, values.name);
    out.write(`Removed agent:${values.name}. Its token no longer works.\n`);
    return;
  }
  if (sub !== 'add') throw new UsageError('expected: agent add|list|remove');
  if (!values.name) throw new UsageError('--name is required');
  if (values.target !== 'local_model' && values.target !== 'cloud_model') {
    throw new UsageError('--target must be local_model or cloud_model');
  }
  const { token } = await addAgent(stateDir, {
    name: values.name,
    target: values.target as AgentTarget,
  });
  out.write(`Registered agent:${values.name} as ${values.target}.\n`);
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
        throw new Error('"mcp --stdio" is not part of this build; it arrives with the MCP slice');
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
