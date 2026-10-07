// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The engines level 1 can use (ADR-0035, ADR-0045): the built-in local rules engine and the cloud
// engines configured in `<state>/level1-engines.yaml`. There is no cloud engine by default; the
// Jev preset is listed as unavailable until an enabled entry exists. The file never holds a
// credential, only the path of an owner-only file. An invalid file, an unsafe credential file or a
// name clash with an agent connection leaves the engine unavailable, with fixed wording as the
// reason (never the address, the credential or the text of an error).

import type { Level1Engine, Level1EngineConfig, Level1EngineInfo } from '@worldbuilder/core';
import {
  createLocalRulesEngine,
  createSystemOneHttpAdapter,
  GENERIC_SYSTEM_ONE_PRESET,
  JEV_PRESET,
  LOCAL_RULES_ENGINE_ID,
  type LocalRulesEngine,
} from '@worldbuilder/level1-engines';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { validators } from './contract.js';

export const LEVEL1_ENGINES_FILE = 'level1-engines.yaml';
/** Ids a configured engine cannot take: the built-in engine and its alias. */
const BUILT_IN_IDS = new Set([LOCAL_RULES_ENGINE_ID, 'local']);

const checkConfig = validators.strict('level1-engines.schema.json');

export type EngineLookup =
  | { readonly kind: 'ok'; readonly engine: Level1Engine }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface Level1EngineRegistryOptions {
  readonly stateDir: string;
  /** Names of the active agent connections: an engine id must not equal one (ADR-0037). */
  readonly agentNames: () => readonly string[];
  /** Injected so that tests never touch the network. */
  readonly fetch?: typeof fetch;
  /** Replaces the built-in engine (tests). */
  readonly localEngine?: LocalRulesEngine | Level1Engine;
  readonly now?: () => Date;
}

interface Loaded {
  readonly entries: readonly Level1EngineConfig[];
  readonly error: string | undefined;
}

const isLocal = (e: Level1Engine): e is LocalRulesEngine =>
  typeof (e as Partial<LocalRulesEngine>).explain === 'function';

export class Level1EngineRegistry {
  readonly local: Level1Engine;
  private loaded: Loaded = { entries: [], error: undefined };
  private signature = 'unread';
  private readonly cache = new Map<string, Level1Engine>();

  constructor(private readonly options: Level1EngineRegistryOptions) {
    this.local =
      options.localEngine ?? createLocalRulesEngine(options.now ? { now: options.now } : {});
  }

  /** The built-in engine's breakdown, if it has one. */
  explainerOf(engine: Level1Engine): LocalRulesEngine | undefined {
    return isLocal(engine) ? engine : undefined;
  }

  get file(): string {
    return path.join(this.options.stateDir, LEVEL1_ENGINES_FILE);
  }

  /** Re-read the file when it changed. A broken file means no cloud engine (fail closed). */
  private async refresh(): Promise<Loaded> {
    let info;
    try {
      info = await lstat(this.file);
    } catch {
      this.signature = 'missing';
      this.cache.clear();
      return (this.loaded = { entries: [], error: undefined });
    }
    const signature = `${info.mtimeMs}:${info.size}:${info.ino}`;
    if (signature === this.signature) return this.loaded;
    this.signature = signature;
    this.cache.clear();
    try {
      if (!info.isFile()) throw new Error('not a regular file');
      const data: unknown = parse(await readFile(this.file, 'utf8')) ?? { engines: [] };
      const checked = checkConfig(data);
      if (!checked.ok) throw new Error('does not match the schema');
      const entries = (data as { engines: Level1EngineConfig[] }).engines;
      const ids = entries.map((e) => e.id.toLowerCase());
      if (new Set(ids).size !== ids.length) throw new Error('an engine id is listed twice');
      this.loaded = { entries, error: undefined };
    } catch {
      this.loaded = {
        entries: [],
        error: `${LEVEL1_ENGINES_FILE} is invalid; no cloud engine is available`,
      };
    }
    return this.loaded;
  }

  /** Why an entry cannot be used, or undefined. Fixed wording only. */
  private async problemOf(entry: Level1EngineConfig): Promise<string | undefined> {
    if (!entry.enabled) return 'disabled';
    const id = entry.id.toLowerCase();
    if (BUILT_IN_IDS.has(id)) return 'the id belongs to the built-in engine';
    if (this.options.agentNames().some((n) => n.toLowerCase() === id)) {
      return 'the id is the name of an agent connection';
    }
    if (entry.apiKeyFile !== undefined) {
      try {
        const info = await lstat(this.keyPath(entry));
        if (!info.isFile()) return 'the credential file is not a regular file';
        if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
          return 'the credential file must be readable by the owner only';
        }
      } catch {
        return 'the credential file cannot be read';
      }
    }
    return undefined;
  }

  private keyPath(entry: Level1EngineConfig): string {
    return path.resolve(this.options.stateDir, entry.apiKeyFile ?? '');
  }

  private build(entry: Level1EngineConfig): Level1Engine | undefined {
    const cached = this.cache.get(entry.id);
    if (cached) return cached;
    try {
      const keyFile = entry.apiKeyFile === undefined ? undefined : this.keyPath(entry);
      const engine = createSystemOneHttpAdapter({
        baseUrl: entry.baseUrl,
        engine: entry.id,
        preset: entry.preset === 'jev' ? JEV_PRESET : GENERIC_SYSTEM_ONE_PRESET,
        ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
        ...(keyFile !== undefined
          ? { apiKey: async () => (await readFile(keyFile, 'utf8')).trim() }
          : {}),
        ...(this.options.now ? { now: this.options.now } : {}),
      });
      this.cache.set(entry.id, engine);
      return engine;
    } catch {
      return undefined; // for example a base URL that is not https
    }
  }

  /** The engines on offer: the built-in one, the configured ones, and the Jev preset if unset. */
  async list(): Promise<Level1EngineInfo[]> {
    const { entries, error } = await this.refresh();
    const out: Level1EngineInfo[] = [
      {
        engine: this.local.engine,
        label: 'Local rules engine (runs in this process; nothing leaves it)',
        target: 'local_model',
        deterministic: this.local.deterministic,
        available: true,
      },
    ];
    for (const entry of entries) {
      const problem =
        (await this.problemOf(entry)) ??
        (this.build(entry) ? undefined : 'the base URL is not usable');
      out.push({
        engine: entry.id,
        ...(entry.label !== undefined ? { label: entry.label } : {}),
        target: 'cloud_model',
        deterministic: false,
        available: problem === undefined,
        ...(problem !== undefined ? { reason: problem } : {}),
      });
    }
    if (!entries.some((e) => e.id === 'jev')) {
      out.push({
        engine: 'jev',
        label: 'Jev',
        target: 'cloud_model',
        deterministic: false,
        available: false,
        reason: error ?? 'not configured',
      });
    }
    return out;
  }

  /** The engine for an id (`local` is the built-in one; it is not looked up here). */
  async resolve(id: string): Promise<EngineLookup> {
    const { entries } = await this.refresh();
    const entry = entries.find((e) => e.id === id);
    if (!entry)
      return id === 'jev' ? { kind: 'unavailable', reason: 'not configured' } : { kind: 'unknown' };
    const problem = await this.problemOf(entry);
    if (problem !== undefined) return { kind: 'unavailable', reason: problem };
    const engine = this.build(entry);
    return engine
      ? { kind: 'ok', engine }
      : { kind: 'unavailable', reason: 'the base URL is not usable' };
  }

  /** The id the built-in engine answers to for the alias `local`. */
  resolveBuiltIn(id: string): Level1Engine | undefined {
    return id === 'local' || id === this.local.engine ? this.local : undefined;
  }
}

/**
 * The ids listed in `<state>/level1-engines.yaml`, for the reserved-name check of `agent add`.
 * Best effort: a missing or invalid file lists none (the engines are unavailable then anyway).
 */
export async function configuredEngineIds(stateDir: string): Promise<string[]> {
  try {
    const data: unknown = parse(await readFile(path.join(stateDir, LEVEL1_ENGINES_FILE), 'utf8'));
    if (!checkConfig(data ?? { engines: [] }).ok) return [];
    return ((data as { engines?: { id: string }[] } | null)?.engines ?? []).map((e) => e.id);
  } catch {
    return [];
  }
}
