// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Proposals (ADR-0011, ADR-0032): nothing counts before a human accepted; accepting writes
// through the StorageAdapter and the agent stays the author; polling never misses or repeats.

import type { Card, ContextPackage, Proposal } from '@worldbuilder/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectContract, makeFixture, type Fixture } from './test-helpers.js';

let f: Fixture;
beforeAll(async () => {
  f = await makeFixture();
});
afterAll(async () => {
  await f.close();
});

const propose = async (name: string, kind: string, payload: unknown): Promise<Proposal> => {
  const res = await f.agent(name, 'POST', '/proposals', { kind, payload });
  expectContract('proposal_create', res, 201);
  return res.json();
};
const accept = (p: Proposal) => f.human('POST', `/proposals/${p.id}/accept`, {});
const lage = async () => (await f.adapter.read(f.ids.lage))!.lage!;

describe('nothing counts before acceptance', () => {
  it('a pending create_card creates no card, changes no Lage and adds no item to a package', async () => {
    const before = (await f.adapter.list({ limit: 200 })).items.length;
    const lageBefore = await lage();
    const p = await propose('scripted', 'create_card', {
      card: {
        format: 2,
        type: 'claim',
        title: 'Proposed claim',
        layer: 'said',
        originSystem: 'Synthetic agent',
      },
      lageId: f.ids.lage,
      x: 5,
      y: 6,
    });
    expect((await f.adapter.list({ limit: 200 })).items).toHaveLength(before);
    expect(await lage()).toEqual(lageBefore);
    const pkg = (
      await f.human('POST', '/context-packages', { worldId: f.worldId })
    ).json() as ContextPackage;
    expect(pkg.items.map((i) => i.card.title)).not.toContain('Proposed claim');
    expect(pkg.pendingProposals).toContainEqual({ proposalId: p.id, kind: 'create_card' });
  });
  it('a pending proposal fires no rule', async () => {
    await propose('scripted', 'place_card', {
      lageId: f.ids.lage,
      cardId: f.ids.evLoose,
      x: 1,
      y: 1,
    });
    const res = await f.human('POST', '/rules/evaluate', { lageId: f.ids.lage });
    const result = res.json().results.find((r: { ruleId: string }) => r.ruleId === f.ids.rule);
    expect(result.triggeringCardIds).toEqual([f.ids.evPublic]);
  });
});

describe('accepting writes through the StorageAdapter and keeps the agent as author', () => {
  it('create_card: the card is authored by the agent, private by default, and placed', async () => {
    const p = await propose('scripted', 'create_card', {
      card: {
        format: 2,
        type: 'claim',
        title: 'Agent claim',
        layer: 'said',
        originSystem: 'Synthetic agent',
      },
      lageId: f.ids.lage,
      x: 40,
      y: 50,
    });
    const before = (await lage()).version;
    expectContract('proposal_accept', await accept(p), 200);
    const created = (await f.adapter.list({ worldId: f.worldId, limit: 200 })).items.find(
      (c) => c.title === 'Agent claim',
    ) as Card;
    expect(created.author).toBe('agent:scripted');
    expect(created.visibility ?? 'private').toBe('private');
    expect(created.release ?? 'private').toBe('private');
    expect(created.training).toBe(false);
    const after = await lage();
    expect(after.version).toBe(before + 1);
    expect(after.cards.find((c) => c.id === created.id)).toMatchObject({ x: 40, y: 50 });
    // the new private card is not visible to a local model
    expect((await f.agent('scripted', 'GET', `/cards/${created.id}`)).statusCode).toBe(404);
    expect((await f.human('GET', `/cards/${created.id}`)).statusCode).toBe(200);
  });
  it('place_card then add_edge on the Lage: the edge carries the proposal author', async () => {
    const place = await propose('scripted', 'place_card', {
      lageId: f.ids.lage,
      cardId: f.ids.evCopy,
      x: 70,
      y: 80,
    });
    expectContract('proposal_accept', await accept(place), 200);
    const edge = await propose('cloud-scripted', 'add_edge', {
      lageId: f.ids.lage,
      from: f.ids.evCopy,
      to: f.ids.evPublic,
      kind: 'supports',
    });
    expectContract('proposal_accept', await accept(edge), 200);
    expect((await lage()).edges).toContainEqual({
      from: f.ids.evCopy,
      to: f.ids.evPublic,
      kind: 'supports',
      by: 'agent:cloud-scripted',
    });
    // accepting the same edge again adds no duplicate
    const again = await propose('scripted', 'add_edge', {
      lageId: f.ids.lage,
      from: f.ids.evCopy,
      to: f.ids.evPublic,
      kind: 'supports',
    });
    await accept(again);
    expect((await lage()).edges).toHaveLength(1);
  });
  it('add_edge without a Lage is written on the card with the agent as author', async () => {
    const p = await propose('scripted', 'add_edge', {
      from: f.ids.evLoose,
      to: f.ids.evPublic,
      kind: 'cites',
    });
    expectContract('proposal_accept', await accept(p), 200);
    const card = (await f.adapter.read(f.ids.evLoose))!;
    expect(card.edges).toContainEqual({
      target: f.ids.evPublic,
      kind: 'cites',
      by: 'agent:scripted',
    });
  });
  it('move_card moves a placed card; every accepted Lage change archives the previous version', async () => {
    const p = await propose('scripted', 'move_card', {
      lageId: f.ids.lage,
      cardId: f.ids.evCopy,
      x: 1,
      y: 2,
    });
    expectContract('proposal_accept', await accept(p), 200);
    expect((await lage()).cards.find((c) => c.id === f.ids.evCopy)).toMatchObject({ x: 1, y: 2 });
    const versions = await f.adapter.versions(f.ids.lage);
    expect(versions.length).toBeGreaterThanOrEqual(3);
    expect(versions.map((v) => v.card.lage?.version)).toEqual(
      [...versions.map((v) => v.card.lage?.version as number)].sort((a, b) => a - b),
    );
  });
  it('comment is accepted without a store change', async () => {
    const before = await lage();
    const p = await propose('scripted', 'comment', { text: 'synthetic comment' });
    const res = await accept(p);
    expectContract('proposal_accept', res, 200);
    expect(await lage()).toEqual(before);
  });
  it('refuses with 409 what cannot be applied and leaves the proposal pending', async () => {
    const missingCard = await propose('scripted', 'place_card', {
      lageId: f.ids.lage,
      cardId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      x: 1,
      y: 1,
    });
    expectContract('proposal_accept', await accept(missingCard), 409);
    const missingLage = await propose('scripted', 'place_card', {
      lageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      cardId: f.ids.evLoose,
      x: 1,
      y: 1,
    });
    expectContract('proposal_accept', await accept(missingLage), 409);
    const unplaced = await propose('scripted', 'add_edge', {
      lageId: f.ids.lage,
      from: f.ids.evLoose,
      to: f.ids.evPublic,
      kind: 'supports',
    });
    expectContract('proposal_accept', await accept(unplaced), 409);
    const pending = (await f.human('GET', '/proposals?status=pending'))
      .json()
      .proposals.map((p: Proposal) => p.id);
    expect(pending).toEqual(expect.arrayContaining([missingCard.id, missingLage.id, unplaced.id]));
  });
  it('two simultaneous accepts: one wins, the other is 409, and the change is written once', async () => {
    const p = await propose('scripted', 'create_card', {
      card: {
        format: 2,
        type: 'claim',
        title: 'Race claim',
        layer: 'said',
        originSystem: 'Synthetic agent',
      },
    });
    const [a, b] = await Promise.all([accept(p), accept(p)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const all = (await f.adapter.list({ limit: 500 })).items.filter(
      (c) => c.title === 'Race claim',
    );
    expect(all).toHaveLength(1);
  });
  it('a rejected proposal changes nothing', async () => {
    const before = await lage();
    const p = await propose('scripted', 'place_card', {
      lageId: f.ids.lage,
      cardId: f.ids.evLoose,
      x: 9,
      y: 9,
    });
    expectContract('proposal_reject', await f.human('POST', `/proposals/${p.id}/reject`, {}), 200);
    expect(await lage()).toEqual(before);
  });
});

describe('polling with a change cursor (ADR-0032)', () => {
  it('both token kinds poll; no proposal is missed or repeated across polls', async () => {
    const first = await f.human('GET', '/proposals?limit=200');
    let cursor = first.json().nextCursor as string;
    const seen = new Set<string>();
    const a = await propose('scripted', 'comment', { text: 'one' });
    const b = await propose('scripted', 'comment', { text: 'two' });
    const poll1 = await f.human('GET', `/proposals?changedSince=${cursor}`);
    expectContract('proposal_list', poll1, 200);
    for (const p of poll1.json().proposals as Proposal[]) seen.add(`${p.id}:${p.status}`);
    expect([...seen].sort()).toEqual([`${a.id}:pending`, `${b.id}:pending`].sort());
    cursor = poll1.json().nextCursor;
    expect((await f.human('GET', `/proposals?changedSince=${cursor}`)).json().proposals).toEqual(
      [],
    );
    await f.human('POST', `/proposals/${a.id}/reject`, {});
    const poll2 = await f.agent('scripted', 'GET', `/proposals?changedSince=${cursor}`);
    expect(poll2.json().proposals.map((p: Proposal) => `${p.id}:${p.status}`)).toEqual([
      `${a.id}:rejected`,
    ]);
  });
  it('paginates with limit and cursor without skipping', async () => {
    const all = (await f.human('GET', '/proposals?limit=200')).json().proposals as Proposal[];
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const res = await f.human('GET', `/proposals?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      const page = res.json();
      if (page.proposals.length === 0) break;
      ids.push(...page.proposals.map((p: Proposal) => p.id));
      cursor = page.nextCursor;
    }
    expect(ids.sort()).toEqual(all.map((p) => p.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('filters by status and by Lage', async () => {
    const accepted = (await f.human('GET', '/proposals?status=accepted')).json()
      .proposals as Proposal[];
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.every((p) => p.status === 'accepted')).toBe(true);
    const onLage = (await f.human('GET', `/proposals?lageId=${f.ids.lage}&limit=200`)).json()
      .proposals as Proposal[];
    expect(onLage.every((p) => (p.payload as { lageId?: string }).lageId === f.ids.lage)).toBe(
      true,
    );
  });
});

describe('what a connection may see of proposals', () => {
  it('a cloud_model connection sees only its own; a local_model and the human see all', async () => {
    const local = await propose('scripted', 'comment', { text: 'derived from a private card' });
    const cloud = await propose('cloud-scripted', 'comment', { text: 'cloud comment' });
    const asCloud = (await f.agent('cloud-scripted', 'GET', '/proposals?limit=200')).json()
      .proposals as Proposal[];
    expect(asCloud.map((p) => p.id)).toContain(cloud.id);
    expect(asCloud.map((p) => p.id)).not.toContain(local.id);
    expect(asCloud.every((p) => p.author === 'agent:cloud-scripted')).toBe(true);
    const asLocal = (await f.agent('scripted', 'GET', '/proposals?limit=200')).json()
      .proposals as Proposal[];
    expect(asLocal.map((p) => p.id)).toEqual(expect.arrayContaining([local.id, cloud.id]));
  });
});

describe('what an agent may put into a proposed card', () => {
  const draft = (extra: Record<string, unknown>) => ({
    format: 2,
    type: 'claim',
    title: 'Drafted by an agent',
    layer: 'said',
    originSystem: 'Synthetic agent',
    ...extra,
  });
  const create = (name: string, card: unknown) =>
    f.agent(name, 'POST', '/proposals', { kind: 'create_card', payload: { card } });

  it('rejects an edge drawn by the human or by another agent (400), accepts the agent own edge', async () => {
    const edge = (by: string) => ({ target: f.ids.evPublic, kind: 'supports', by });
    for (const by of ['human', 'agent:cloud-scripted', 'unknown']) {
      const res = await create('scripted', draft({ edges: [edge(by)] }));
      expectContract('proposal_create', res, 400);
      expect(res.json().detail).toContain('agent:scripted');
    }
    const mixed = await create(
      'scripted',
      draft({ edges: [edge('agent:scripted'), edge('human')] }),
    );
    expectContract('proposal_create', mixed, 400);
    const own = await create('scripted', draft({ edges: [edge('agent:scripted')] }));
    expectContract('proposal_create', own, 201);
  });
  it('checks the edges again at accept: a stored human edge is a 409 and the proposal stays pending', async () => {
    // A proposal stored before the rule existed, or written around the API, must not pass.
    const stored = await f.service.app.services.localState.createProposal(
      {
        kind: 'create_card',
        payload: {
          card: draft({
            title: 'Smuggled edge',
            edges: [{ target: f.ids.evPublic, kind: 'supports', by: 'human' }],
          }),
        },
      } as never,
      'agent:scripted',
    );
    const res = await accept(stored);
    expectContract('proposal_accept', res, 409);
    expect(
      (await f.adapter.list({ limit: 500 })).items.some((c) => c.title === 'Smuggled edge'),
    ).toBe(false);
    const again = await f.human('GET', '/proposals?status=pending&limit=200');
    expect(again.json().proposals.map((p: Proposal) => p.id)).toContain(stored.id);
  });
  it.each(['worlds', 'tags', 'rating', 'class', 'visibility', 'release', 'training'])(
    'may not set %s (400)',
    async (field) => {
      const value: Record<string, unknown> = {
        worlds: [f.worldId],
        tags: ['x'],
        rating: 5,
        class: 'decision',
        visibility: 'public',
        release: 'private',
        training: false,
      };
      const res = await create('scripted', draft({ [field]: value[field] }));
      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toContain(field);
    },
  );
  it('a created card joins the worlds of the Lage it is placed on, and no others', async () => {
    const p = await propose('scripted', 'create_card', {
      card: draft({ title: 'Placed agent card' }),
      lageId: f.ids.lage,
      x: 1,
      y: 2,
    });
    expectContract('proposal_accept', await accept(p), 200);
    const card = (await f.adapter.list({ limit: 500 })).items.find(
      (c) => c.title === 'Placed agent card',
    ) as Card;
    expect(card.worlds).toEqual([f.worldId]);
    expect(card.tags).toBeUndefined();
  });
});

describe('proposal_create passes the same gate checks as the knowledge tools', () => {
  const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const sections = (cardsUsed: string[]) => ({
    situation: 's',
    trigger: 't',
    conditions: 'c',
    facts: 'f',
    priorities: 'p',
    action: 'a',
    alternatives: 'al',
    exclusions: 'e',
    rationale: 'r',
    cardsUsed,
    outcome: 'open',
  });
  const post = (name: string, kind: string, payload: unknown) =>
    f.agent(name, 'POST', '/proposals', { kind, payload });

  it('a decision draft may only use cards the agent may know (a hidden one looks like a missing one)', async () => {
    const draft = (id: string) => ({
      card: { format: 2, type: 'decision', title: 'D', sections: sections([id]) },
    });
    const hidden = await post('scripted', 'create_card', draft(f.ids.evPrivate));
    const missing = await post('scripted', 'create_card', draft(MISSING));
    expect([hidden.statusCode, missing.statusCode]).toEqual([400, 400]);
    expect(hidden.body.replace(f.ids.evPrivate, 'X')).toBe(missing.body.replace(MISSING, 'X'));
    expect((await post('scripted', 'create_card', draft(f.ids.evPublic))).statusCode).toBe(201);
  });
  it('record_outcome needs a decision the agent may know: hidden and unknown are both 404', async () => {
    const priv = await f.human('POST', '/decisions', {
      format: 2,
      type: 'decision',
      title: 'Private decision',
      sections: sections([f.ids.evPublic]),
    });
    const card = priv.json() as Card;
    const body = (id: string) => ({
      decisionId: id,
      outcome: 'Done.',
      expectedContentHash: card.contentHash,
    });
    const hidden = await post('scripted', 'record_outcome', body(card.id));
    const missing = await post('scripted', 'record_outcome', body(MISSING));
    expect([hidden.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(hidden.body).toBe(missing.body);
    // not a decision at all: the same answer
    expect((await post('scripted', 'record_outcome', body(f.ids.evPublic))).statusCode).toBe(404);
    await f.adapter.patch(card.id, { visibility: 'public' });
    expect((await post('scripted', 'record_outcome', body(card.id))).statusCode).toBe(201);
  });
});
