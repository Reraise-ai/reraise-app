// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// `worldbuilder serve` over the real markdown-files adapter and a temporary copy of the
// synthetic Hormuz store: open the Lage, place a card, draw an edge, set a stance, and see
// them again after the process restarts (AC-05).

import type { Card, Lage } from '@worldbuilder/core';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addAgent } from './agent-registry.js';
import { main } from './main.js';
import type { Service } from './service.js';

const HORMUZ = fileURLToPath(new URL('../../../examples/hormuz', import.meta.url));

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wb-api-hormuz-'));
  await cp(HORMUZ, path.join(dir, 'store'), { recursive: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

/** Start the real command over the copied store; returns the service and a fetch helper. */
async function serve() {
  const port = await freePort();
  let service!: Service;
  const code = await main(
    [
      'serve',
      '--store',
      path.join(dir, 'store'),
      '--state',
      path.join(dir, 'state'),
      '--port',
      String(port),
    ],
    {
      stdout: { write: () => true },
      stderr: { write: () => true },
      logger: false,
      onServe: (s) => {
        service = s;
      },
    },
  );
  expect(code).toBe(-1);
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: {
        'x-worldbuilder-session': service.sessionToken,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, json: (await res.json()) as never as Record<string, never> };
  };
  return { service, call };
}

/** Every file under `root`, as text. Used to show a stance note never landed in the card store. */
async function textsUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(await readFile(full, 'utf8'));
    }
  };
  await walk(root);
  return out;
}

describe('worldbuilder serve on the Hormuz example store', () => {
  let lageId: string;
  let loose: Card;

  it('lists the Hormuz world and opens its Lage', async () => {
    const { service, call } = await serve();
    try {
      const worlds = await call('GET', '/worlds');
      expect(worlds.status).toBe(200);
      expect((worlds.json['worlds'] as unknown as { name: string }[]).map((w) => w.name)).toContain(
        'Hormuz',
      );
      const lagen = await call('GET', '/cards?type=lage');
      const found = (lagen.json['cards'] as unknown as Card[])[0]!;
      lageId = found.id;
      const lage = await call('GET', `/lagen/${lageId}`);
      expect(lage.status).toBe(200);
      const state = (lage.json as unknown as Card).lage as Lage;
      const placed = new Set(state.cards.map((c) => c.id));
      const cards = await call('GET', '/cards?limit=200');
      loose = (cards.json['cards'] as unknown as Card[]).find(
        (c) => c.type !== 'lage' && !placed.has(c.id),
      )!;
      expect(loose).toBeDefined();
    } finally {
      await service.close();
    }
  });

  it('places a card with lage_save and the change persists after a restart', async () => {
    const first = await serve();
    try {
      const current = (await first.call('GET', `/lagen/${lageId}`)).json as unknown as Card;
      const lage = current.lage as Lage;
      const saved = await first.call('PUT', `/lagen/${lageId}`, {
        ...lage,
        cards: [...lage.cards, { id: loose.id, x: 321, y: 123 }],
        version: lage.version + 1,
        updatedAt: new Date().toISOString(),
      });
      expect(saved.status).toBe(200);
      const stale = await first.call('PUT', `/lagen/${lageId}`, {
        ...lage,
        version: lage.version + 1,
      });
      expect(stale.status).toBe(409);
    } finally {
      await first.service.close();
    }
    const second = await serve();
    try {
      const reloaded = (await second.call('GET', `/lagen/${lageId}`)).json as unknown as Card;
      expect(reloaded.lage?.cards.find((c) => c.id === loose.id)).toMatchObject({ x: 321, y: 123 });
    } finally {
      await second.service.close();
    }
  });

  it('keeps a drawn edge and a private stance after the process restarts (AC-05)', async () => {
    const note = 'synthetic restart note';
    const first = await serve();
    let fromId = '';
    let toId = '';
    try {
      const lagen = await first.call('GET', '/cards?type=lage');
      const listed = (lagen.json['cards'] as unknown as Card[])[0]!;
      const current = (await first.call('GET', `/lagen/${listed.id}`)).json as unknown as Card;
      const lage = current.lage as Lage;
      fromId = lage.cards[0]!.id;
      toId = lage.cards[1]!.id;
      const saved = await first.call('PUT', `/lagen/${listed.id}`, {
        ...lage,
        edges: [...lage.edges, { from: fromId, to: toId, kind: 'supports', by: 'human' }],
        version: lage.version + 1,
        updatedAt: new Date().toISOString(),
      });
      expect(saved.status).toBe(200);
      const stance = await first.call('PUT', `/cards/${fromId}/stance`, {
        position: 'rejected',
        weight: 2,
        note,
      });
      expect(stance.status).toBe(200);
    } finally {
      await first.service.close();
    }

    const second = await serve();
    try {
      const lagen = await second.call('GET', '/cards?type=lage');
      const listed = (lagen.json['cards'] as unknown as Card[])[0]!;
      const reloaded = (await second.call('GET', `/lagen/${listed.id}`)).json as unknown as Card;
      expect(reloaded.lage?.edges).toContainEqual({
        from: fromId,
        to: toId,
        kind: 'supports',
        by: 'human',
      });
      const stance = await second.call('GET', `/cards/${fromId}/stance`);
      expect(stance.status).toBe(200);
      expect(stance.json).toMatchObject({
        cardId: fromId,
        position: 'rejected',
        weight: 2,
        note,
      });
      const onDisk = await readFile(path.join(dir, 'state', 'stances', `${fromId}.json`), 'utf8');
      expect(onDisk).toContain(note);
      expect((await textsUnder(path.join(dir, 'store'))).some((text) => text.includes(note))).toBe(
        false,
      );
    } finally {
      await second.service.close();
    }
  });
});

describe('a card removed from the Lage (AC-22)', () => {
  it('drops that card from the next context package and leaves the card in the store', async () => {
    const { service, call } = await serve();
    try {
      const worlds = await call('GET', '/worlds');
      const worldId = (worlds.json['worlds'] as unknown as { id: string; name: string }[]).find(
        (w) => w.name === 'Hormuz',
      )!.id;
      const lagen = await call('GET', '/cards?type=lage');
      const lageCard = (lagen.json['cards'] as unknown as Card[])[0]!;
      const lage = lageCard.lage as Lage;
      const gone = lage.cards[0]!;
      const kept = lage.cards[1]!;
      const saved = await call('PUT', `/lagen/${lageCard.id}`, {
        ...lage,
        cards: lage.cards.filter((c) => c.id !== gone.id),
        edges: lage.edges.filter((e) => e.from !== gone.id && e.to !== gone.id),
        version: lage.version + 1,
        updatedAt: new Date().toISOString(),
      });
      expect(saved.status).toBe(200);
      const pkg = await call('POST', '/context-packages', { worldId, lageId: lageCard.id });
      expect(pkg.status).toBe(200);
      const ids = (pkg.json['items'] as unknown as { card: { id: string } }[]).map(
        (item) => item.card.id,
      );
      expect(ids).not.toContain(gone.id);
      expect(ids).toContain(kept.id);
      expect((await call('GET', `/cards/${gone.id}`)).status).toBe(200);
      // Put the card back so the later tests in this file see the example Lage.
      const back = await call('PUT', `/lagen/${lageCard.id}`, {
        ...lage,
        version: lage.version + 2,
        updatedAt: new Date().toISOString(),
      });
      expect(back.status).toBe(200);
    } finally {
      await service.close();
    }
  });
});

describe('proposals the real adapter refuses', () => {
  it('a rule card whose body has its own "## Rule" heading cannot be written: accept is 409 and the proposal stays pending', async () => {
    const { service, call } = await serve();
    try {
      // The service re-reads the registry, so an agent registered now is known at once.
      const { token } = await addAgent(service.stateDir, {
        name: 'rule-writer',
        target: 'local_model',
      });
      const base = service.app.server.address() as { port: number };
      const propose = await fetch(`http://127.0.0.1:${base.port}/proposals`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'create_card',
          payload: {
            card: {
              format: 2,
              type: 'rule',
              title: 'Looks like a rule',
              rule: {
                when: [{ kind: 'card_on_lage', card: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }],
                then: 'Prefer the first option',
              },
              body: 'Intro.\n\n## Rule\n\nnot a real rule block',
            },
          },
        }),
      });
      expect(propose.status).toBe(201);
      const proposal = (await propose.json()) as { id: string };
      const accepted = await call('POST', `/proposals/${proposal.id}/accept`, {});
      expect(accepted.status).toBe(409);
      expect(accepted.json['status']).toBe(409);
      const pending = await call('GET', '/proposals?status=pending&limit=200');
      expect((pending.json['proposals'] as unknown as { id: string }[]).map((p) => p.id)).toContain(
        proposal.id,
      );
      const found = await call('GET', '/cards?text=Looks%20like%20a%20rule');
      expect(found.json['cards']).toEqual([]);
    } finally {
      await service.close();
    }
  });
});

describe('rule cards of the Hormuz store (a "## Rule" section in the file)', () => {
  it('rules_evaluate reads them through the real adapter', async () => {
    const { service, call } = await serve();
    try {
      const lagen = await call('GET', '/cards?type=lage');
      const lageId = (lagen.json['cards'] as unknown as Card[])[0]!.id;
      const res = await call('POST', '/rules/evaluate', { lageId });
      expect(res.status).toBe(200);
      const results = res.json['results'] as unknown as {
        ruleId: string;
        rule: { then: string };
      }[];
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every((r) => typeof r.rule.then === 'string')).toBe(true);
    } finally {
      await service.close();
    }
  });
});
