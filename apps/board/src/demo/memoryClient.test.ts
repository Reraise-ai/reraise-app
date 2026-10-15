// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import type { Card } from '@worldbuilder/core';
import { createMemoryClient, type DemoSeed } from './memoryClient.js';

const WORLD = '01JA0000000000000000000W01';
const LAGE = '01JA0000000000000000000L01';
const CARD = '01JA0000000000000000000C01';

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function card(over: Partial<Card> & { id: string; title: string; type: Card['type'] }): Card {
  return {
    externalId: over.id,
    uri: `wb:00000000-0000-4000-8000-000000000001/${over.id}`,
    format: 2,
    author: 'human',
    contentHash: `sha256:${'ab'.repeat(32)}`,
    worlds: [WORLD],
    visibility: 'public',
    ...over,
  };
}

function seed(stamp = 'stamp-a'): DemoSeed {
  return {
    synthetic: true,
    stamp,
    storeInstanceId: '00000000-0000-4000-8000-000000000001',
    worlds: [{ id: WORLD, name: 'Hormuz' }],
    cards: [
      card({
        id: LAGE,
        title: 'Q4 tanker routing',
        type: 'lage',
        lage: {
          question: 'Reroute?',
          options: ['Reroute', 'Wait'],
          cards: [{ id: CARD, x: 0, y: 0 }],
          seats: [{ name: 'You', kind: 'human' }],
          edges: [],
          version: 3,
          updatedAt: '2026-09-16T09:30:00.000Z',
        },
      }),
      card({ id: CARD, title: 'Wire report', type: 'evidence', layer: 'evidenced' }),
    ],
    versions: {},
  };
}

describe('demo memory client', () => {
  it('lists the start world and keeps a Lage edit in the given storage', async () => {
    const storage = memory();
    const first = createMemoryClient(seed(), storage);
    expect((await first.world_list()).worlds[0]?.name).toBe('Hormuz');
    expect((await first.cards_search({ type: 'lage' })).cards.map((c) => c.id)).toEqual([LAGE]);
    const loaded = await first.lage_get(LAGE);
    await first.lage_save(LAGE, { ...loaded.lage!, question: 'Changed?', version: 4 });
    await expect(first.lage_save(LAGE, { ...loaded.lage!, version: 4 })).rejects.toMatchObject({
      status: 409,
    });

    const second = createMemoryClient(seed(), storage);
    expect((await second.lage_get(LAGE)).lage?.question).toBe('Changed?');
    expect((await second.lage_versions(LAGE)).versions.map((v) => v.version)).toEqual([3]);

    await second.stance_save(CARD, { position: 'believed', weight: 2, note: 'local' });
    const pkg = await second.context_package_get({ worldId: WORLD, lageId: LAGE });
    expect(pkg.items.find((item) => item.card.id === CARD)?.stance?.note).toBe('local');
    expect((await second.findings_list()).findings).toEqual([]);
    expect((await second.rules_evaluate({ lageId: LAGE })).results).toEqual([]);

    const other = createMemoryClient(seed('stamp-b'), storage);
    expect((await other.lage_get(LAGE)).lage?.question).toBe('Reroute?');

    second.reset();
    const reset = createMemoryClient(seed(), storage);
    expect((await reset.lage_get(LAGE)).lage?.question).toBe('Reroute?');
    await expect(reset.stance_get(CARD)).rejects.toMatchObject({ status: 404 });
    await expect(reset.model_ask(LAGE, { engine: 'ollama', question: 'hi' })).rejects.toMatchObject(
      {
        status: 501,
      },
    );
  });

  it('keeps a what-if layer off the cards', async () => {
    const storage = memory();
    const client = createMemoryClient(seed(), storage);
    const before = JSON.stringify((await client.lage_get(LAGE)).lage);
    await client.scenario_replace(LAGE, { assumptions: [{ statement: 'The talks fail' }] });
    const again = createMemoryClient(seed(), storage);
    expect((await again.scenario_get(LAGE)).assumptions.map((item) => item.statement)).toEqual([
      'The talks fail',
    ]);
    expect(JSON.stringify((await again.lage_get(LAGE)).lage)).toBe(before);
  });

  it('opens an event stream and does not call fetch', async () => {
    const client = createMemoryClient(seed(), memory());
    const res = await client.openEvents(LAGE, new AbortController().signal);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });
});
