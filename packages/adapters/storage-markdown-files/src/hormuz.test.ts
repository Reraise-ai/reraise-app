// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The adapter over the complete synthetic Hormuz example store (the M1 scenario data).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { computeContentHash } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { cleanupAfterAll, copyHormuz, HORMUZ, openStore } from './testing/store.js';
import { schemaValidator } from './validate.js';

cleanupAfterAll();

const WIRE = '01M1E34QM03WVTE8T1RYS3AM18';
const NAVY = '01M1EDEAG082WZ7T7D204BHZDC';
const LAGE = '01M1F21G80R816A1T0V2P6RACH';
const DECISION = '01M1F5FBW0DPQND9KSXC12WHJW';
const RULE = '01M1EV5S00YXKKGEG772AZM7P9';
const WORLD = '01M1DZPW00JGXPRPG4179ZPNB8';

describe('the Hormuz example store', () => {
  it('reads all twelve cards as valid canonical cards with ids, uris and hashes', async () => {
    const adapter = await openStore(HORMUZ);
    const { items } = await adapter.list();
    expect(items).toHaveLength(12);
    const validate = schemaValidator('card.schema.json');
    for (const card of items) {
      expect(validate(card), JSON.stringify(validate.errors)).toBe(true);
      expect(card.uri).toBe(`wb:${adapter.storeInstanceId}/${card.id}`);
      expect(card.contentHash).toBe(computeContentHash(card));
    }
    expect(adapter.diagnostics()).toEqual([]);
    expect(adapter.storeInstanceId).toBe('45aaff12-777f-40e3-a97c-8a592e1ea4f6');
  });

  it('reads the Lage, the decision, the rule and the actor with their structured content', async () => {
    const adapter = await openStore(HORMUZ);
    const lage = await adapter.read(LAGE);
    expect(lage?.lage?.version).toBe(3);
    expect(lage?.lage?.cards).toHaveLength(6);
    expect(lage?.lage?.seats.map((s) => s.kind)).toEqual(['human', 'agent']);
    const decision = await adapter.read(DECISION);
    expect(decision?.sections?.cardsUsed).toHaveLength(3);
    expect(decision?.sections?.outcome).toBe('open');
    expect((await adapter.read(RULE))?.rule?.then).toContain('Reroute');
    const navy = await adapter.read(NAVY);
    expect(navy?.interests?.[0]?.source).toBe(WIRE);
    expect(navy?.worlds).toEqual([WORLD]);
    const legacy = (await adapter.list()).items.find((c) => c.title === 'Shipping routes');
    expect(legacy?.format).toBe(1);
    expect(legacy?.author).toBe('unknown');
  });

  it('matches the fixture reader of the contract checks, hash for hash', async () => {
    // scripts/markdown-cards.mjs is the independent implementation the schemas are checked with.
    // @ts-expect-error plain JavaScript module without types
    const fixture = (await import('../../../../scripts/markdown-cards.mjs')) as {
      toCanonicalCard(text: string, store: unknown): Record<string, unknown>;
    };
    const adapter = await openStore(HORMUZ);
    const worlds = new Map([['Hormuz', WORLD]]);
    const dir = path.join(HORMUZ, 'cards');
    for (const name of await readdir(dir)) {
      const expected = fixture.toCanonicalCard(await readFile(path.join(dir, name), 'utf8'), {
        storeInstanceId: adapter.storeInstanceId,
        worlds,
      });
      const actual = await adapter.read(expected['id'] as string);
      expect(actual, name).toEqual(expected);
    }
  });

  it('lists the world and filters by it', async () => {
    const adapter = await openStore(HORMUZ);
    expect(await adapter.listWorlds()).toEqual([
      expect.objectContaining({ id: WORLD, name: 'Hormuz' }),
    ]);
    expect((await adapter.list({ worldId: WORLD })).items).toHaveLength(11);
    expect((await adapter.list({ worldId: '01M1DZPW00JGXPRPG4179ZPNB9' })).items).toEqual([]);
  });

  it('searches by text, type, layer, tag and world', async () => {
    const adapter = await openStore(HORMUZ);
    const titles = async (q: Parameters<typeof adapter.search>[0]) =>
      (await adapter.search(q)).items.map((c) => c.id);
    expect(await titles({ text: 'wire report' })).toContain(WIRE);
    expect(await titles({ text: 'WIRE  Réport' })).toContain(WIRE); // case and accents fold
    expect(await titles({ type: 'lage' })).toEqual([LAGE]);
    expect(await titles({ tags: ['shipping'] })).toEqual([WIRE]);
    expect(await titles({ tags: ['shipping', 'nope'] })).toEqual([]);
    expect(await titles({ layer: 'evidenced' })).toContain(WIRE);
    expect(await titles({ text: 'tanker', worldId: WORLD, type: 'organisation' })).toEqual([
      '01M1EGW640BMD0RDT5NGRMFD70',
    ]);
    // the title match ranks first
    expect((await titles({ text: 'restrictions' }))[0]).toBe(WIRE);
  });

  it('pages with a cursor', async () => {
    const adapter = await openStore(HORMUZ);
    const first = await adapter.list({ limit: 5 });
    expect(first.items).toHaveLength(5);
    const second = await adapter.list({ limit: 5, cursor: first.nextCursor });
    const third = await adapter.list({ limit: 5, cursor: second.nextCursor });
    expect(third.nextCursor).toBeUndefined();
    const ids = [...first.items, ...second.items, ...third.items].map((c) => c.id);
    expect(new Set(ids).size).toBe(12);
    await expect(adapter.list({ cursor: 'x' })).rejects.toThrow(/cursor/);
  });

  it('rewrites the Lage with a new version and archives the previous one next to it', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const before = (await adapter.read(LAGE))!;
    const lage = before.lage!;
    const placed = {
      ...lage,
      version: 4,
      updatedAt: '2026-10-06T10:00:00Z',
      cards: [...lage.cards, { id: '01M1EV5S00YXKKGEG772AZM7P9', x: 10, y: 20 }],
      edges: [
        ...lage.edges,
        { from: WIRE, to: NAVY, kind: 'supports' as const, by: 'human' as const },
      ],
    };
    await adapter.patch(LAGE, { lage: placed }, { lageVersion: 3 });
    const after = (await adapter.read(LAGE))!;
    expect(after.lage).toEqual(placed);
    expect(after.title).toBe(before.title);

    const archiveDir = path.join(dir, 'cards', '_archive');
    expect(await readdir(archiveDir)).toEqual(['10-lage-q4-routing.v3.md']);
    const old = await adapter.versions(LAGE);
    expect(old.map((v) => v.version)).toEqual([3]);
    expect(old[0]?.card.lage?.cards).toHaveLength(6);
    expect(old[0]?.card.lage?.version).toBe(3);

    // The rewrite is byte-preserving outside the version fields and the JSON block.
    const original = await readFile(path.join(HORMUZ, 'cards', '10-lage-q4-routing.md'), 'utf8');
    const rewritten = await readFile(path.join(dir, 'cards', '10-lage-q4-routing.md'), 'utf8');
    const strip = (t: string) =>
      t
        .replace(/^version: \d+$/m, 'version: N')
        .replace(/^updatedAt: .*$/m, 'updatedAt: T')
        .replace(/```json[\s\S]*?```/, '```json```');
    expect(strip(rewritten)).toBe(strip(original));
    expect(rewritten).toContain('version: 4\n');
    expect(rewritten).toContain('updatedAt: 2026-10-06T10:00:00Z');
    // a stale second save is refused and changes nothing
    await expect(
      adapter.patch(LAGE, { lage: { ...placed, version: 5 } }, { lageVersion: 3 }),
    ).rejects.toThrow(/version conflict/);
  });

  it('rewrites a decision section and keeps the other ten verbatim', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const card = (await adapter.read(DECISION))!;
    await adapter.patch(DECISION, {
      sections: { ...card.sections!, outcome: 'Rerouted; cost was within the estimate.' },
    });
    const file = path.join(dir, 'cards', '11-decision-q4-routing.md');
    const original = await readFile(
      path.join(HORMUZ, 'cards', '11-decision-q4-routing.md'),
      'utf8',
    );
    expect(await readFile(file, 'utf8')).toBe(
      original.replace(
        /## Outcome\n\nopen\n$/,
        '## Outcome\n\nRerouted; cost was within the estimate.\n',
      ),
    );
  });

  it('rewrites a rule block', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const card = (await adapter.read(RULE))!;
    await adapter.patch(RULE, { rule: { ...card.rule!, then: 'Hold course' } });
    expect((await adapter.read(RULE))?.rule?.then).toBe('Hold course');
  });
});
