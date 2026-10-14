// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The source connectors behind findings_list (ADR-0014). Nothing is connected until an
// address or a vault path is set. A blank value is the same as an absent one.

import {
  DOCUMENTS_SOURCE,
  HTTP_JSON_SOURCE,
  OBSIDIAN_SOURCE,
  SourceReadError,
  createDocumentSource,
  createHttpJsonSource,
  createObsidianVaultSource,
  type SourceConnector,
  type VaultFile,
} from '@worldbuilder/core';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface SourceOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly httpUrl?: string;
  readonly documentsUrl?: string;
  readonly documentsKey?: string;
  readonly obsidianVault?: string;
  /** Tests pass the connectors. Environment addresses are ignored then. */
  readonly connectors?: ReadonlyMap<string, SourceConnector>;
}

const value = (
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined => {
  const trimmed = env[key]?.trim();
  return trimmed ? trimmed : undefined;
};

/** Addresses from the environment. */
export function sourceOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): SourceOptions {
  const httpUrl = value(env, 'WORLDBUILDER_SOURCE_HTTP_URL');
  const documentsUrl = value(env, 'WORLDBUILDER_DOCUMENTS_URL');
  const documentsKey = value(env, 'WORLDBUILDER_DOCUMENTS_KEY');
  const obsidianVault = value(env, 'WORLDBUILDER_OBSIDIAN_VAULT');
  return {
    ...(httpUrl ? { httpUrl } : {}),
    ...(documentsUrl ? { documentsUrl, ...(documentsKey ? { documentsKey } : {}) } : {}),
    ...(obsidianVault ? { obsidianVault } : {}),
  };
}

/**
 * Markdown notes under `root`. Dot entries and links are skipped.
 * shortcut: at most 500 notes and 8 directories deep, raise both when a vault is larger.
 */
export async function listVaultFiles(root: string): Promise<VaultFile[]> {
  const base = path.resolve(root);
  const out: VaultFile[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || out.length >= 500) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      throw new SourceReadError('http_error');
    }
    for (const entry of entries) {
      if (out.length >= 500) return;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.resolve(dir, entry.name);
      const relative = path.relative(base, full);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const info = await stat(full);
      out.push({
        relativePath: relative.split(path.sep).join('/'),
        modifiedAt: info.mtime.toISOString(),
      });
    }
  };
  await walk(base, 0);
  return out;
}

/** One connector per configured source. An empty map lists nothing and sends nothing. */
export function buildSources(options: SourceOptions = {}): ReadonlyMap<string, SourceConnector> {
  if (options.connectors) return options.connectors;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const map = new Map<string, SourceConnector>();
  if (options.httpUrl) {
    map.set(HTTP_JSON_SOURCE, createHttpJsonSource({ url: options.httpUrl, fetch: fetchImpl }));
  }
  if (options.documentsUrl) {
    map.set(
      DOCUMENTS_SOURCE,
      createDocumentSource({
        url: options.documentsUrl,
        fetch: fetchImpl,
        ...(options.documentsKey ? { apiKey: options.documentsKey } : {}),
        ...(options.now ? { now: options.now } : {}),
      }),
    );
  }
  if (options.obsidianVault) {
    const root = options.obsidianVault;
    const vaultName = path.basename(path.resolve(root)) || 'vault';
    map.set(
      OBSIDIAN_SOURCE,
      createObsidianVaultSource({
        vaultName,
        listFiles: () => listVaultFiles(root),
      }),
    );
  }
  return map;
}
