// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Credentials (ADR-0026, ADR-0029): the human session token and the registered agent
// connections. Tokens are compared by SHA-256, so the lookup does not leak how much of a guess
// was right. Agent connections live in `<state>/agents.json` (device-only, owner-only file).

import type { AgentAuthor } from '@worldbuilder/core';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type AgentTarget = 'local_model' | 'cloud_model';

/** Who is calling: the human at the board, or one registered agent connection. */
export type Principal =
  | { readonly kind: 'human' }
  | {
      readonly kind: 'agent';
      readonly name: string;
      readonly author: AgentAuthor;
      readonly target: AgentTarget;
    };

/** The disclosure target of a caller, taken from its credential and never from a request. */
export const targetOf = (p: Principal): 'screen' | AgentTarget =>
  p.kind === 'human' ? 'screen' : p.target;

/** Binding key of a connection-bound cloud transfer. */
export const connectionIdOf = (p: Principal & { kind: 'agent' }): string => p.name;

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MIN_TOKEN_LENGTH = 32;

/** A fresh 256-bit token, URL-safe. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export const AGENTS_FILE = 'agents.json';
export const SESSION_TOKEN_FILE = 'session-token';

interface AgentRecord {
  readonly name: string;
  readonly target: AgentTarget;
  readonly tokenSha256: string;
}

/** Parse and validate the contents of `agents.json`. Throws with a reason on any problem. */
export function parseAgents(text: string): AgentRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('agents.json is not valid JSON');
  }
  const list = (data as { agents?: unknown } | null)?.agents;
  if (
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data) ||
    Object.keys(data).some((k) => k !== 'agents') ||
    !Array.isArray(list)
  ) {
    throw new Error('agents.json must be an object with an "agents" array');
  }
  const records: AgentRecord[] = [];
  for (const [i, raw] of list.entries()) {
    const entry = raw as Record<string, unknown> | null;
    const where = `agents[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${where} must be an object`);
    }
    const unknownKeys = Object.keys(entry).filter(
      (k) => !['name', 'target', 'token', 'tokenSha256'].includes(k),
    );
    if (unknownKeys.length > 0) throw new Error(`${where} has unknown fields`);
    const { name, target, token, tokenSha256 } = entry;
    if (typeof name !== 'string' || !AGENT_NAME.test(name)) {
      throw new Error(`${where}.name must match ${AGENT_NAME.source}`);
    }
    if (target !== 'local_model' && target !== 'cloud_model') {
      throw new Error(`${where}.target must be local_model or cloud_model`);
    }
    if ((token === undefined) === (tokenSha256 === undefined)) {
      throw new Error(`${where} needs exactly one of token and tokenSha256`);
    }
    let hash: string;
    if (token !== undefined) {
      if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
        throw new Error(
          `${where}.token must be a string of at least ${MIN_TOKEN_LENGTH} characters`,
        );
      }
      hash = sha256Hex(token);
    } else {
      if (typeof tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(tokenSha256)) {
        throw new Error(`${where}.tokenSha256 must be 64 lower-case hex characters`);
      }
      hash = tokenSha256;
    }
    records.push({ name, target, tokenSha256: hash });
  }
  const names = new Set(records.map((r) => r.name));
  const hashes = new Set(records.map((r) => r.tokenSha256));
  if (names.size !== records.length) throw new Error('agent names must be unique');
  if (hashes.size !== records.length) throw new Error('agent tokens must be unique');
  return records;
}

/**
 * The registered agent connections. The file is re-read when it changes; if it becomes invalid
 * every agent is refused until it is fixed (fail closed), and the reason is kept for display.
 */
export class AgentRegistry {
  private byHash = new Map<string, AgentRecord>();
  private signature = 'unread';
  private _error: string | undefined;

  constructor(private readonly file: string) {}

  get error(): string | undefined {
    return this._error;
  }

  /** Names and targets, never tokens. */
  get connections(): readonly { name: string; target: AgentTarget }[] {
    return [...this.byHash.values()].map(({ name, target }) => ({ name, target }));
  }

  /** Load now; throws if the file is unsafe or invalid (used at start: refuse to start). */
  async loadStrict(): Promise<void> {
    await this.refresh(true);
  }

  private async refresh(strict: boolean): Promise<void> {
    let info;
    try {
      info = await lstat(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.byHash = new Map();
      this.signature = 'missing';
      this._error = undefined;
      return;
    }
    const signature = `${info.mtimeMs}:${info.size}:${info.ino}`;
    if (signature === this.signature && (this._error === undefined || !strict)) return;
    try {
      if (!info.isFile()) throw new Error('agents.json must be a regular file, not a link');
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
        throw new Error('agents.json must not be readable by group or others (chmod 600)');
      }
      const records = parseAgents(await readFile(this.file, 'utf8'));
      this.byHash = new Map(records.map((r) => [r.tokenSha256, r]));
      this._error = undefined;
    } catch (e) {
      this.byHash = new Map();
      this._error = e instanceof Error ? e.message : String(e);
      this.signature = signature;
      if (strict) throw e;
      return;
    }
    this.signature = signature;
  }

  /** The agent connection a bearer token belongs to, if it is registered. */
  async lookup(token: string): Promise<Principal | undefined> {
    await this.refresh(false);
    const record = this.byHash.get(sha256Hex(token));
    if (!record) return undefined;
    return {
      kind: 'agent',
      name: record.name,
      author: `agent:${record.name}` as AgentAuthor,
      target: record.target,
    };
  }
}

/** Write a file readable by the owner only; replaces an existing file (also a symbolic link). */
export async function writePrivateFile(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  if (process.platform !== 'win32') await chmod(temp, 0o600);
  await rename(temp, file);
}

/**
 * Register a new agent connection and return its token, which is shown to the user once; only
 * its hash is stored. Fails if the name is taken or the existing file is invalid.
 */
export async function addAgent(
  stateDir: string,
  agent: { name: string; target: AgentTarget },
): Promise<{ token: string }> {
  const file = path.join(stateDir, AGENTS_FILE);
  let existing: AgentRecord[] = [];
  try {
    existing = parseAgents(await readFile(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (!AGENT_NAME.test(agent.name)) throw new Error(`agent name must match ${AGENT_NAME.source}`);
  if (existing.some((r) => r.name === agent.name)) {
    throw new Error(`an agent named ${agent.name} is already registered`);
  }
  const token = newToken();
  const records = [
    ...existing,
    { name: agent.name, target: agent.target, tokenSha256: sha256Hex(token) },
  ];
  await writePrivateFile(file, `${JSON.stringify({ agents: records }, null, 2)}\n`);
  return { token };
}
