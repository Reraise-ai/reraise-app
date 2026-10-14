// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Writes the static demo's start world from the example stores. The board fetches this JSON.
// It does not read the markdown store.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * @param {string} repoRoot
 * @param {string} outFile
 * @param {(root: string, options: { watch: boolean }) => Promise<{
 *   diagnostics(): { path: string, message: string }[],
 *   list(query: { limit: number, cursor?: string }): Promise<{ items: unknown[], nextCursor?: string }>,
 *   versions(id: string): Promise<{ version: number, archivedAt: string, card: { lage?: unknown } }[]>,
 *   listWorlds(): Promise<unknown[]>,
 *   storeInstanceId: string,
 *   close(): void,
 * }>} openStore
 */
const DEMO_WORLDS = ['hormuz', 'gold', 'vitamin-d'];

export async function writeDemoWorld(repoRoot, outFile, openStore) {
  const cards = [];
  /** @type {Record<string, { version: number, archivedAt: string, lage: unknown }[]>} */
  const versions = {};
  const worlds = [];
  let storeInstanceId;
  for (const name of DEMO_WORLDS) {
    const store = await openStore(path.join(repoRoot, 'examples', name), { watch: false });
    try {
      const problems = store.diagnostics();
      if (problems.length > 0) {
        throw new Error(problems.map((p) => `${name}: ${p.path}: ${p.message}`).join('\n'));
      }
      const mine = [];
      let cursor;
      do {
        const page = await store.list({ limit: 200, ...(cursor ? { cursor } : {}) });
        mine.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      if (mine.length === 0) throw new Error(`the ${name} example has no cards`);
      for (const card of mine) {
        if (card.type !== 'lage' || !card.id) continue;
        const archived = await store.versions(card.id);
        versions[card.id] = archived.flatMap((entry) =>
          entry.card.lage
            ? [{ version: entry.version, archivedAt: entry.archivedAt, lage: entry.card.lage }]
            : [],
        );
      }
      cards.push(...mine);
      worlds.push(...(await store.listWorlds()));
      storeInstanceId ??= store.storeInstanceId;
    } finally {
      store.close();
    }
  }
  const body = {
    synthetic: true,
    storeInstanceId,
    worlds,
    cards,
    versions,
  };
  const stamp = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify({ ...body, stamp }));
  return { cards: cards.length, stamp };
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(here, '..');
  const adapter = pathToFileURL(
    path.join(repoRoot, 'packages', 'adapters', 'storage-markdown-files', 'dist', 'index.js'),
  ).href;
  const { MarkdownFilesAdapter } = await import(adapter);
  const outFile = path.join(repoRoot, 'apps', 'board', 'dist', 'demo-seed', 'world.json');
  const wrote = await writeDemoWorld(repoRoot, outFile, (root, options) =>
    MarkdownFilesAdapter.open(root, options),
  );
  console.log(`demo world: ${wrote.cards} cards -> ${outFile}`);
}
