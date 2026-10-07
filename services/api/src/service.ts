// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Composition root (ADR-0029): opens the device-only local state (refusing an unsafe state
// directory), creates the human session token, loads the registered agent connections and
// builds the Board API over one StorageAdapter. The storage adapter is injected, so tests use
// the in-memory fake and the CLI uses the markdown-files adapter.

import type { LocalStateStore, StorageAdapter } from '@worldbuilder/core';
import { createLocalStateStore, type LocalStateOptions } from '@worldbuilder/local-state';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AGENTS_FILE, AgentRegistry } from './agent-registry.js';
import { SESSION_TOKEN_FILE, newToken, writePrivateFile } from './auth.js';
import { acquireStateLock, type StateLock } from './state-lock.js';
import { buildApp, DEFAULT_PORT, type BoardApp } from './app.js';

export interface ServiceOptions {
  readonly storage: StorageAdapter;
  /** Explicit state directory (absolute); the per-OS default when omitted (ADR-0030). */
  readonly stateDir?: string;
  /** Roots of the configured stores; the state directory must not lie inside one. */
  readonly storeRoots?: readonly string[];
  /** An already opened local state, for tests; skips the state directory handling. */
  readonly localState?: LocalStateStore;
  readonly localStateOptions?: Omit<LocalStateOptions, 'explicitPath' | 'storeRoots'>;
  readonly host?: string;
  readonly port?: number;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly bodyLimit?: number;
  readonly syntheticStores?: readonly string[];
  /** Write a rule file that allows every card on the screen if none exists (the CLI does). */
  readonly seedDefaultGateRules?: boolean;
  readonly logger?: boolean | object;
  readonly now?: () => Date;
}

export interface Service {
  readonly app: BoardApp;
  readonly stateDir: string;
  /** The human session token of this run. Show it to the user once; never log it. */
  readonly sessionToken: string;
  readonly sessionTokenFile: string;
  readonly agentsFile: string;
  readonly agents: AgentRegistry;
  readonly host: string;
  /** Start listening; returns the bound address. */
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export const DEFAULT_GATE_RULES = `# Written by "worldbuilder serve" on first start. Without a rule the gate denies everything
# (ADR-0012): this one lets the board show your cards on your own screen. Nothing here lets a
# card leave the device. Add allow rules for local_model or cloud_model deliberately.
rules:
  - id: screen-all
    effect: allow
    targets: [screen]
    match: {}
`;

export async function createService(options: ServiceOptions): Promise<Service> {
  const host = options.host ?? '127.0.0.1';
  const localState =
    options.localState ??
    (await createLocalStateStore({
      ...options.localStateOptions,
      ...(options.stateDir ? { explicitPath: options.stateDir } : {}),
      ...(options.storeRoots ? { storeRoots: options.storeRoots } : {}),
    }));
  const stateDir = localState.stateDir;
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  // One service per state directory: before anything is written there.
  const lock: StateLock = await acquireStateLock(stateDir);
  try {
    return await assemble(options, host, localState, stateDir, lock);
  } catch (e) {
    await lock.release();
    throw e;
  }
}

async function assemble(
  options: ServiceOptions,
  host: string,
  localState: LocalStateStore,
  stateDir: string,
  lock: StateLock,
): Promise<Service> {
  if (options.seedDefaultGateRules) {
    try {
      await writeFile(path.join(stateDir, 'gate-rules.yaml'), DEFAULT_GATE_RULES, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }

  const sessionToken = newToken();
  const sessionTokenFile = path.join(stateDir, SESSION_TOKEN_FILE);
  await writePrivateFile(sessionTokenFile, `${sessionToken}\n`);

  const agentsFile = path.join(stateDir, AGENTS_FILE);
  const agents = new AgentRegistry(agentsFile);
  await agents.loadStrict(); // an unsafe or invalid agents.yaml refuses the start

  const app = await buildApp({
    storage: options.storage,
    localState,
    agents,
    sessionToken,
    host,
    port: options.port ?? DEFAULT_PORT,
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.bodyLimit !== undefined ? { bodyLimit: options.bodyLimit } : {}),
    ...(options.syntheticStores ? { syntheticStores: options.syntheticStores } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  return {
    app,
    stateDir,
    sessionToken,
    sessionTokenFile,
    agentsFile,
    agents,
    host,
    async listen() {
      await app.listen({ host, port: options.port ?? DEFAULT_PORT });
      const address = app.server.address();
      if (address === null || typeof address === 'string') throw new Error('no TCP address');
      app.allowPort(address.port);
      return { host: address.address, port: address.port };
    },
    async close() {
      await app.close();
      await lock.release();
      (options.storage as { close?: () => void }).close?.();
    },
  };
}
