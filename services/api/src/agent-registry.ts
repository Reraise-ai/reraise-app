// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The registry of agent connections (ADR-0026, ADR-0037): `<state>/agents.yaml`, owner-only,
// validated against schemas/agent-connections.schema.json. It stores the SHA-256 of each bearer
// token, never the token. Removing a connection revokes it (`revokedAt`); the record stays so a
// name is never reused for another token.

import type { AgentAuthor } from '@worldbuilder/core';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import {
  connectionKey,
  newToken,
  sha256Hex,
  writePrivateFile,
  type AgentTarget,
  type Principal,
} from './auth.js';
import { validators } from './contract.js';

export const AGENTS_FILE = 'agents.yaml';

const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/**
 * Names that act as `agent:<name>` and must not be taken by a connection because a level-1
 * engine uses them (ADR-0035, ADR-0037). No engine is configured in this build, so the ids of
 * the built-in engine and the engines the socket names are reserved; the ids configured in
 * `level1-engines.yaml` are passed to `addAgent` (`configuredEngineIds`).
 */
export const RESERVED_AGENT_NAMES: readonly string[] = ['local', 'local-rules', 'jev'];

const HASH_PREFIX = 'sha256:';

/** One stored connection (schema `AgentConnection`). */
export interface AgentRecord {
  readonly name: string;
  readonly target: AgentTarget;
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly revokedAt?: string;
}

const checkRegistry = validators.strict('agent-connections.schema.json');

/** Parse and validate the contents of `agents.yaml`. Throws with a reason on any problem. */
export function parseAgents(text: string): AgentRecord[] {
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    throw new Error('agents.yaml is not valid YAML');
  }
  if (data === null || data === undefined) data = { connections: [] }; // an empty file
  const checked = checkRegistry(data);
  if (!checked.ok) throw new Error(`agents.yaml is invalid: ${checked.message}`);
  const records = (data as { connections: AgentRecord[] }).connections;
  const names = new Set(records.map((r) => r.name));
  if (names.size !== records.length) throw new Error('agent names must be unique');
  const active = records.filter((r) => r.revokedAt === undefined);
  if (new Set(active.map((r) => r.tokenHash)).size !== active.length) {
    throw new Error('agent tokens must be unique');
  }
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
  private readonly listeners: ((live: ReadonlySet<string>) => void)[] = [];

  constructor(private readonly file: string) {}

  get error(): string | undefined {
    return this._error;
  }

  /** Names and targets of the active connections, never tokens. */
  get connections(): readonly { name: string; target: AgentTarget }[] {
    return [...this.byHash.values()].map(({ name, target }) => ({ name, target }));
  }

  /**
   * Called with the connection keys (`connectionKey`) of the active connections whenever the file
   * was read again and its content changed, also when it became invalid (then the set is empty).
   */
  subscribe(listener: (live: ReadonlySet<string>) => void): void {
    this.listeners.push(listener);
  }

  /** Look at the file now (the service does this on a timer, so revocations do not wait for a request). */
  async poll(): Promise<void> {
    await this.refresh(false);
  }

  private publish(): void {
    const live = new Set(
      [...this.byHash.values()].map((r) => connectionKey(r.name, r.target, r.tokenHash)),
    );
    for (const listener of this.listeners) listener(live);
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
      const changed = this.signature !== 'missing';
      this.signature = 'missing';
      this._error = undefined;
      if (changed) this.publish();
      return;
    }
    const signature = `${info.mtimeMs}:${info.size}:${info.ino}`;
    if (signature === this.signature && (this._error === undefined || !strict)) return;
    const changed = signature !== this.signature;
    try {
      assertSafeFile(info);
      const records = parseAgents(await readFile(this.file, 'utf8'));
      this.byHash = new Map(
        records.filter((r) => r.revokedAt === undefined).map((r) => [r.tokenHash, r]),
      );
      this._error = undefined;
    } catch (e) {
      this.byHash = new Map();
      this._error = e instanceof Error ? e.message : String(e);
      this.signature = signature;
      if (changed) this.publish();
      if (strict) throw e;
      return;
    }
    this.signature = signature;
    if (changed) this.publish();
  }

  /** The agent connection a bearer token belongs to, if it is registered and not revoked. */
  async lookup(token: string): Promise<Principal | undefined> {
    await this.refresh(false);
    const record = this.byHash.get(`${HASH_PREFIX}${sha256Hex(token)}`);
    if (!record) return undefined;
    return {
      kind: 'agent',
      name: record.name,
      author: `agent:${record.name}` as AgentAuthor,
      target: record.target,
      tokenHash: record.tokenHash,
    };
  }
}

function assertSafeFile(info: { isFile(): boolean; mode: number }): void {
  if (!info.isFile()) throw new Error('agents.yaml must be a regular file, not a link');
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error('agents.yaml must not be readable by group or others (chmod 600)');
  }
}

async function readRecords(stateDir: string): Promise<AgentRecord[]> {
  const file = path.join(stateDir, AGENTS_FILE);
  let info;
  try {
    info = await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return [];
  }
  assertSafeFile(info);
  return parseAgents(await readFile(file, 'utf8'));
}

const writeRecords = (stateDir: string, records: readonly AgentRecord[]) =>
  writePrivateFile(
    path.join(stateDir, AGENTS_FILE),
    `# Agent connections (ADR-0037). Written by "worldbuilder agent"; holds token hashes only.\n${stringify({ connections: records })}`,
  );

/**
 * Register a new agent connection and return its token, which is shown to the user once; only
 * its hash is stored. Fails if the name was ever used or the existing file is invalid.
 */
export async function addAgent(
  stateDir: string,
  agent: { name: string; target: AgentTarget },
  now: () => Date = () => new Date(),
  engineIds: readonly string[] = [],
): Promise<{ token: string }> {
  if (!AGENT_NAME.test(agent.name)) throw new Error(`agent name must match ${AGENT_NAME.source}`);
  const lower = agent.name.toLowerCase();
  if ([...RESERVED_AGENT_NAMES, ...engineIds].some((id) => id.toLowerCase() === lower)) {
    throw new Error(`the name ${agent.name} is reserved for a level-1 engine; choose another name`);
  }
  const existing = await readRecords(stateDir);
  const same = existing.find((r) => r.name === agent.name);
  if (same) {
    throw new Error(
      same.revokedAt === undefined
        ? `an agent named ${agent.name} is already registered`
        : `the name ${agent.name} belonged to a revoked agent; choose another name`,
    );
  }
  const token = newToken();
  await writeRecords(stateDir, [
    ...existing,
    {
      name: agent.name,
      target: agent.target,
      tokenHash: `${HASH_PREFIX}${sha256Hex(token)}`,
      createdAt: now().toISOString(),
    },
  ]);
  return { token };
}

/** Name, target class, creation time and revocation of every connection; never tokens. */
export async function listAgents(
  stateDir: string,
): Promise<{ name: string; target: AgentTarget; createdAt: string; revokedAt?: string }[]> {
  return (await readRecords(stateDir)).map(({ name, target, createdAt, revokedAt }) => ({
    name,
    target,
    createdAt,
    ...(revokedAt !== undefined ? { revokedAt } : {}),
  }));
}

/** Revoke a connection; its token stops working at once (the running service re-reads the file). */
export async function removeAgent(
  stateDir: string,
  name: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const existing = await readRecords(stateDir);
  if (!existing.some((r) => r.name === name && r.revokedAt === undefined)) {
    throw new Error(`no active agent named ${name}`);
  }
  await writeRecords(
    stateDir,
    existing.map((r) => (r.name === name ? { ...r, revokedAt: now().toISOString() } : r)),
  );
}
