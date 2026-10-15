// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MarkdownFilesAdapter } from '@worldbuilder/storage-markdown-files';
import { writeDemoWorld } from './export-demo-world.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HORMUZ_LAGE = '01M1F21G80R816A1T0V2P6RACH';

describe('export-demo-world', () => {
  it('writes the Hormuz Lage into the demo JSON', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-demo-world-'));
    try {
      const outFile = path.join(dir, 'world.json');
      await writeDemoWorld(repoRoot, outFile, (root, options) =>
        MarkdownFilesAdapter.open(root, options),
      );
      const world = JSON.parse(await readFile(outFile, 'utf8'));
      expect(world.synthetic).toBe(true);
      expect(world.stamp).toMatch(/^[0-9a-f]{64}$/);
      const lage = world.cards.find((card) => card.id === HORMUZ_LAGE);
      expect(lage?.type).toBe('lage');
      expect(lage?.title).toBe('Q4 tanker routing');
      expect(world.worlds.some((w) => w.name === 'Hormuz')).toBe(true);
      expect(world.worlds.some((w) => w.name === 'Gold market')).toBe(true);
      const theme = world.cards.find(
        (card) => card.type === 'lage' && card.lage?.question === 'Vitamin D',
      );
      expect(theme?.lage?.questions?.map((q) => q.text)).toEqual([
        'Two trials, two answers',
        '20 or 60?',
        'Instead of the vaccine?',
      ]);
      expect(theme?.lage?.questions?.every((q) => q.for.length > 0 && q.against.length > 0)).toBe(
        true,
      );
      expect(theme?.lage?.collectorCardId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      const ids = world.cards.map((card) => card.id);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
