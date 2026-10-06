// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The registry of agent connections (ADR-0026): one small module, so that the storage format
// can change in one place. Today: `<state>/agents.json`, owner-only, hash-only on creation.
// Planned: `<state>/agents.yaml` validated by schemas/agent-connections.schema.json (ADR-0037);
// replace `parseAgents`, `serializeAgents` and `AGENTS_FILE` and keep the exports below.

import type { AgentAuthor } from '@worldbuilder/core';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { newToken, sha256Hex, writePrivateFile, type AgentTarget, type Principal } from './auth.js';

export const AGENTS_FILE = 'agents.json';

const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MIN_TOKEN_LENGTH = 32;

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

/** The stored form of the registry. */
function serializeAgents(records: readonly AgentRecord[]): string {
  return `${JSON.stringify({ agents: records }, null, 2)}\n`;
}

async function readRecords(stateDir: string): Promise<AgentRecord[]> {
  try {
    return parseAgents(await readFile(path.join(stateDir, AGENTS_FILE), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return [];
  }
}

const writeRecords = (stateDir: string, records: readonly AgentRecord[]) =>
  writePrivateFile(path.join(stateDir, AGENTS_FILE), serializeAgents(records));

/**
 * Register a new agent connection and return its token, which is shown to the user once; only
 * its hash is stored. Fails if the name is taken or the existing file is invalid.
 */
export async function addAgent(
  stateDir: string,
  agent: { name: string; target: AgentTarget },
): Promise<{ token: string }> {
  const existing = await readRecords(stateDir);
  if (!AGENT_NAME.test(agent.name)) throw new Error(`agent name must match ${AGENT_NAME.source}`);
  if (existing.some((r) => r.name === agent.name)) {
    throw new Error(`an agent named ${agent.name} is already registered`);
  }
  const token = newToken();
  await writeRecords(stateDir, [
    ...existing,
    { name: agent.name, target: agent.target, tokenSha256: sha256Hex(token) },
  ]);
  return { token };
}

/** Names and targets of the registered connections; never tokens. */
export async function listAgents(
  stateDir: string,
): Promise<{ name: string; target: AgentTarget }[]> {
  return (await readRecords(stateDir)).map(({ name, target }) => ({ name, target }));
}

/** Remove a connection; its token stops working at once (the running service re-reads the file). */
export async function removeAgent(stateDir: string, name: string): Promise<void> {
  const existing = await readRecords(stateDir);
  if (!existing.some((r) => r.name === name)) throw new Error(`no agent named ${name}`);
  await writeRecords(
    stateDir,
    existing.filter((r) => r.name !== name),
  );
}
