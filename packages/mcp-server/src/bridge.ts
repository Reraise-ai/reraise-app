// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// `worldbuilder mcp --stdio` (ADR-0029): a stateless relay between an MCP host that speaks
// stdio and the running service's /mcp endpoint. Every JSON-RPC message goes through
// unchanged, in both directions; the Streamable HTTP client transport keeps the `Mcp-Session-Id`
// and opens the server-to-client stream, so server-initiated messages reach the host. The
// bridge never opens a store, evaluates a gate or writes a file: reading its token file is the
// only file access. The token comes from the environment or a token file, never from argv.
// If the service is not running it says so and stops; it does not start one.

import { readFile } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';

export const DEFAULT_SERVICE_URL = 'http://127.0.0.1:4310';
export const TOKEN_ENV = 'WORLDBUILDER_AGENT_TOKEN';
export const TOKEN_FILE_ENV = 'WORLDBUILDER_AGENT_TOKEN_FILE';
export const URL_ENV = 'WORLDBUILDER_URL';

/** A refusal with a message for the person who configured the bridge. */
export class BridgeError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The agent token of this bridge: `WORLDBUILDER_AGENT_TOKEN`, or the first line of the file
 * named by `WORLDBUILDER_AGENT_TOKEN_FILE`. Exactly one of the two.
 */
export async function resolveToken(
  env: Env,
  read: (file: string) => Promise<string> = (f) => readFile(f, 'utf8'),
): Promise<string> {
  const direct = env[TOKEN_ENV];
  const file = env[TOKEN_FILE_ENV];
  if (direct !== undefined && direct !== '' && file !== undefined && file !== '') {
    throw new BridgeError(`set ${TOKEN_ENV} or ${TOKEN_FILE_ENV}, not both`);
  }
  let token: string | undefined;
  if (file !== undefined && file !== '') {
    try {
      token = (await read(file)).split(/\r?\n/, 1)[0]?.trim();
    } catch {
      throw new BridgeError(`cannot read the token file named by ${TOKEN_FILE_ENV}`);
    }
  } else if (direct !== undefined && direct !== '') {
    token = direct.trim();
  }
  if (token === undefined || token === '') {
    throw new BridgeError(
      `no agent token: set ${TOKEN_FILE_ENV} to the token file (or ${TOKEN_ENV}); ` +
        'register the agent with "worldbuilder agent add"',
    );
  }
  return token;
}

export interface BridgeOptions {
  /** Base URL of the running service, for example `http://127.0.0.1:4310`. */
  readonly url: string;
  readonly token: string;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly stderr?: { write(text: string): unknown };
  readonly fetch?: FetchLike;
  /** How long the liveness check of the service may take (milliseconds). */
  readonly healthTimeoutMs?: number;
}

/** The `/mcp` URL of a service URL; only http(s) addresses are accepted. */
export function mcpUrl(base: string): URL {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new BridgeError(`not a service URL: ${base}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BridgeError('the service URL must start with http:// or https://');
  }
  if (url.username !== '' || url.password !== '') {
    throw new BridgeError('the service URL must not contain credentials');
  }
  return new URL('/mcp', url);
}

/** Liveness only: /health is open and carries no data, so the token is not sent to it. */
async function checkAlive(url: URL, fetchFn: FetchLike, timeoutMs: number): Promise<void> {
  const health = new URL('/health', url);
  try {
    const res = await fetchFn(health, { signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    throw new BridgeError(
      `the Worldbuilder service is not reachable at ${url.origin}. Start it with ` +
        '"worldbuilder serve --store <path>"; the bridge does not start one.',
    );
  }
}

const isRequest = (m: JSONRPCMessage): m is JSONRPCMessage & { id: string | number } =>
  isJSONRPCRequest(m);

/**
 * Run the relay until the host closes stdin or the service connection ends. Resolves with the
 * process exit code: 0 for a clean end, 1 when the service cannot be reached.
 */
export async function runBridge(options: BridgeOptions): Promise<number> {
  const stderr = options.stderr ?? process.stderr;
  const fetchFn: FetchLike = options.fetch ?? ((u, init) => fetch(u, init));
  let endpoint: URL;
  try {
    endpoint = mcpUrl(options.url);
    await checkAlive(endpoint, fetchFn, options.healthTimeoutMs ?? 5000);
  } catch (e) {
    stderr.write(`worldbuilder mcp: ${(e as Error).message}\n`);
    return 1;
  }

  const stdio = new StdioServerTransport(options.stdin, options.stdout);
  const http = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${options.token}` } },
    fetch: fetchFn,
  });

  let initializeId: string | number | undefined;
  let warnedAuth = false;
  const failure = (e: unknown): string => {
    const text = e instanceof Error ? e.message : String(e);
    if (/\b40[13]\b/.test(text)) {
      return 'the service refused the agent token (unknown, revoked or not allowed)';
    }
    return 'the service did not answer this request';
  };

  const done = new Promise<number>((resolve) => {
    let finished = false;
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      void Promise.allSettled([http.terminateSession().catch(() => undefined)]).then(() =>
        Promise.allSettled([http.close(), stdio.close()]).then(() => resolve(code)),
      );
    };
    // The host closed stdin: the session is over. (The SDK's stdio transport does not report the
    // end of its input itself.)
    const input = options.stdin ?? process.stdin;
    input.once('end', () => finish(0));
    input.once('close', () => finish(0));
    stdio.onclose = () => finish(0);
    http.onclose = () => finish(0);
    stdio.onerror = (e) => stderr.write(`worldbuilder mcp: stdio error: ${e.message}\n`);
    http.onerror = (e) => {
      // Stream errors (a dropped GET stream) are reported once per cause, never with content.
      stderr.write(`worldbuilder mcp: ${failure(e)}\n`);
    };

    http.onmessage = (message) => {
      if (
        initializeId !== undefined &&
        isJSONRPCResultResponse(message) &&
        message.id === initializeId
      ) {
        const version = (message.result as { protocolVersion?: unknown }).protocolVersion;
        if (typeof version === 'string') http.setProtocolVersion(version);
        initializeId = undefined;
      }
      stdio.send(message).catch((e: Error) => {
        stderr.write(`worldbuilder mcp: cannot write to stdout: ${e.message}\n`);
      });
    };

    stdio.onmessage = (message) => {
      if (isRequest(message) && (message as { method?: string }).method === 'initialize') {
        initializeId = message.id;
      }
      http.send(message).catch((e: unknown) => {
        const reason = failure(e);
        if (!warnedAuth || !/refused the agent token/.test(reason)) {
          stderr.write(`worldbuilder mcp: ${reason}\n`);
        }
        if (/refused the agent token/.test(reason)) warnedAuth = true;
        // A request that cannot be delivered must not leave the host waiting.
        if (isRequest(message)) {
          void stdio.send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32000, message: reason },
          });
        }
      });
    };
  });

  await http.start();
  await stdio.start();
  return done;
}

export interface BridgeMainIo {
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly stderr?: { write(text: string): unknown };
  readonly fetch?: FetchLike;
  readonly readFile?: (file: string) => Promise<string>;
}

/**
 * The command behind `worldbuilder mcp --stdio`. `args` are the arguments after `mcp`; the
 * only options are `--stdio` and `--url <service URL>` (the token is never an argument).
 */
export async function bridgeMain(
  args: readonly string[],
  env: Env,
  io: BridgeMainIo = {},
): Promise<number> {
  const stderr = io.stderr ?? process.stderr;
  let stdio = false;
  let url = env[URL_ENV] ?? DEFAULT_SERVICE_URL;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--stdio') stdio = true;
    else if (a === '--url' && args[i + 1] !== undefined) url = args[++i]!;
    else if (/^--(token|agent-token)(=|$)/.test(a)) {
      stderr.write(
        `worldbuilder mcp: the token is not an argument (it would show in process listings); set ${TOKEN_FILE_ENV}\n`,
      );
      return 2;
    } else {
      stderr.write(
        `worldbuilder mcp: unknown argument ${a.startsWith('--') ? a.split('=')[0] : '(positional)'}\n`,
      );
      return 2;
    }
  }
  if (!stdio) {
    stderr.write('worldbuilder mcp: only --stdio is supported: worldbuilder mcp --stdio\n');
    return 2;
  }
  let token: string;
  try {
    token = await resolveToken(env, io.readFile);
  } catch (e) {
    stderr.write(`worldbuilder mcp: ${(e as Error).message}\n`);
    return 2;
  }
  return runBridge({
    url,
    token,
    ...(io.stdin ? { stdin: io.stdin } : {}),
    ...(io.stdout ? { stdout: io.stdout } : {}),
    stderr,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
}
