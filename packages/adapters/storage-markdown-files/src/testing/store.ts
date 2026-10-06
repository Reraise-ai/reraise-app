// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Test support: temporary stores copied from the synthetic Hormuz example.

import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { mintUlid } from '../ulid.js';
import { MarkdownFilesAdapter, type OpenOptions } from '../adapter.js';

export const HORMUZ = fileURLToPath(new URL('../../../../../examples/hormuz', import.meta.url));

const temps: string[] = [];
const adapters: MarkdownFilesAdapter[] = [];

/** Remove every temporary store and stop every adapter opened through these helpers. */
export function cleanupAfterAll(): void {
  afterAll(async () => {
    for (const a of adapters) a.close();
    await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
  });
}

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wb-md-'));
  temps.push(dir);
  return dir;
}

/** A temporary copy of examples/hormuz; `cards: false` keeps the configuration and world only. */
export async function copyHormuz(options: { cards: boolean } = { cards: true }): Promise<string> {
  const dir = await tempDir();
  await cp(HORMUZ, dir, {
    recursive: true,
    filter: (src) => options.cards || !src.includes(`${path.sep}cards`),
  });
  await mkdir(path.join(dir, 'cards'), { recursive: true });
  return dir;
}

export async function openStore(dir: string, options: OpenOptions = {}) {
  const adapter = await MarkdownFilesAdapter.open(dir, { watch: false, ...options });
  adapters.push(adapter);
  return adapter;
}

/** Write a card file behind the adapter's back, as another tool would. */
export async function writeCardFile(dir: string, name: string, text: string): Promise<string> {
  const file = path.join(dir, 'cards', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  return file;
}

export const newId = (): string => mintUlid();

export const readCardFile = (file: string): Promise<string> => readFile(file, 'utf8');
