// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Contract tests: every operation of schemas/openapi/board-api.yaml is called through
// fastify.inject and its response is validated against the contract (status declared, media
// type, JSON Schema). The last test fails if an operation of the contract was never called.

import type { Card, DisclosureTransfer, Proposal } from '@worldbuilder/core';
import { StorageError, type StorageErrorCode } from '@worldbuilder/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadOperations } from './contract.js';
import { cardOf, covered, expectContract, makeFixture, type Fixture } from './test-helpers.js';

const NOW = '2026-02-01T00:00:00Z';
const emptyLage = (version = 1) => ({
  question: 'Synthetic question?',
  options: ['Yes', 'No'],
  cards: [],
  seats: [{ name: 'Me', kind: 'human' }],
  edges: [],
  version,
  updatedAt: NOW,
});
const sections = (cardsUsed: string[]) => ({
  situation: 'A synthetic situation.',
  trigger: 'A synthetic trigger.',
  conditions: 'Synthetic conditions.',
  facts: 'Synthetic facts.',
  priorities: 'Synthetic priorities.',
  action: 'Synthetic action.',
  alternatives: 'Synthetic alternatives.',
  exclusions: 'Synthetic exclusions.',
  rationale: 'Synthetic rationale.',
  cardsUsed,
  outcome: 'open',
});

let clock = Date.parse('2026-02-01T12:00:00Z');
let f: Fixture;
beforeAll(async () => {
  f = await makeFixture({ now: () => new Date(clock) });
});
afterAll(async () => {
  await f.close();
});

describe('world_list', () => {
  it('lists the worlds for the human', async () => {
    const res = await f.human('GET', '/worlds');
    expectContract('world_list', res, 200);
    expect(res.json().worlds).toHaveLength(2);
  });
  it('shows a cloud_model connection only public worlds', async () => {
    const res = await f.agent('cloud-scripted', 'GET', '/worlds');
    expectContract('world_list', res, 200);
    expect(res.json().worlds.map((w: { name: string }) => w.name)).toEqual([
      'Synthetic public world',
    ]);
  });
  it('answers 401 without a credential', async () => {
    expectContract('world_list', await f.raw({ method: 'GET', url: '/worlds' }), 401);
  });
});

describe('lage_create, lage_get, lage_save', () => {
  let lageId: string;
  it('lage_create makes a Lage card authored by the human', async () => {
    const res = await f.human('POST', '/lagen', {
      title: 'Created Lage',
      worlds: [f.worldId],
      lage: emptyLage(),
    });
    expectContract('lage_create', res, 201);
    const card = cardOf(res);
    expect(card.type).toBe('lage');
    expect(card.author).toBe('human');
    lageId = card.id;
  });
  it('lage_create rejects a body without a title (400) and a version other than 1', async () => {
    expectContract('lage_create', await f.human('POST', '/lagen', { lage: emptyLage() }), 400);
    const res = await f.human('POST', '/lagen', { title: 'T', lage: emptyLage(2) });
    expectContract('lage_create', res, 400);
  });
  it('lage_get returns the Lage; unknown and non-Lage ids are 404', async () => {
    expectContract('lage_get', await f.human('GET', `/lagen/${lageId}`), 200);
    expectContract('lage_get', await f.human('GET', '/lagen/01ARZ3NDEKTSV4RRFFQ69G5FAV'), 404);
    expectContract('lage_get', await f.human('GET', `/lagen/${f.ids.evPublic}`), 404);
    expectContract('lage_get', await f.human('GET', '/lagen/not-an-id'), 404);
  });
  it('lage_save writes version + 1, archives the previous one, and refuses a stale save', async () => {
    const res = await f.human('PUT', `/lagen/${lageId}`, { ...emptyLage(2), question: 'Changed?' });
    expectContract('lage_save', res, 200);
    expect(cardOf(res).lage?.version).toBe(2);
    expect((await f.adapter.versions(lageId)).map((v) => v.card.lage?.version)).toEqual([1]);
    expectContract('lage_save', await f.human('PUT', `/lagen/${lageId}`, emptyLage(2)), 409);
    expectContract('lage_save', await f.human('PUT', `/lagen/${lageId}`, { question: 'x' }), 400);
    expectContract(
      'lage_save',
      await f.human('PUT', '/lagen/01ARZ3NDEKTSV4RRFFQ69G5FAV', emptyLage(2)),
      404,
    );
  });
});

describe('cards_search and card_get', () => {
  it('cards_search returns gate-cleared cards for the screen', async () => {
    const res = await f.human('GET', `/cards?worldId=${f.worldId}&text=Synthetic`);
    expectContract('cards_search', res, 200);
    const titles = res.json().cards.map((c: Card) => c.title);
    expect(titles).toContain('Synthetic private note');
  });
  it('cards_search hides a private card from a local_model and does not list it as denied', async () => {
    const res = await f.agent('scripted', 'GET', '/cards?text=Synthetic');
    expectContract('cards_search', res, 200);
    const body = res.json();
    expect(body.cards.map((c: Card) => c.id)).not.toContain(f.ids.evPrivate);
    expect(body.denied).toBeUndefined();
    expect(res.body).not.toContain(f.ids.evPrivate);
    expect(res.body).not.toContain('PRIVATE-MARKER-TEXT');
  });
  it('cards_search gives a cloud_model connection no content at all', async () => {
    const res = await f.agent('cloud-scripted', 'GET', '/cards?text=Synthetic');
    expectContract('cards_search', res, 200);
    expect(res.json().cards).toEqual([]);
    expect(res.json().denied).toBeUndefined();
  });
  it('cards_search of a model target answers alike whether or not a denied card matches', async () => {
    // The private card holds PRIVATE-MARKER-TEXT; a query for it must look exactly like a query
    // for a text no card holds: no card, no denied entry, no cursor, byte-identical answers.
    for (const agent of ['scripted', 'cloud-scripted']) {
      const probe = await f.agent(agent, 'GET', '/cards?text=PRIVATE-MARKER-TEXT');
      const absent = await f.agent(agent, 'GET', '/cards?text=ABSENT-MARKER-TEXT');
      expectContract('cards_search', probe, 200);
      expect(probe.body).toBe(absent.body);
      expect(probe.json()).toEqual({ cards: [] });
      // The same holds in one world, and with a type or layer filter.
      const inWorld = await f.agent(
        agent,
        'GET',
        `/cards?worldId=${f.worldId}&text=PRIVATE-MARKER-TEXT&layer=said&type=claim`,
      );
      const inWorldAbsent = await f.agent(
        agent,
        'GET',
        `/cards?worldId=${f.worldId}&text=ABSENT-MARKER-TEXT&layer=said&type=claim`,
      );
      expect(inWorld.body).toBe(inWorldAbsent.body);
    }
    // Filters still find the cards the target may see.
    const found = await f.agent('scripted', 'GET', '/cards?text=alpha&type=claim');
    expect(found.json().cards.map((c: Card) => c.id)).toContain(f.ids.evPublic);
  });
  it('cards_search honours limit and cursor and rejects bad parameters', async () => {
    const first = await f.human('GET', `/cards?worldId=${f.worldId}&limit=2`);
    expectContract('cards_search', first, 200);
    expect(first.json().cards).toHaveLength(2);
    const cursor = first.json().nextCursor as string;
    const second = await f.human('GET', `/cards?worldId=${f.worldId}&limit=2&cursor=${cursor}`);
    expectContract('cards_search', second, 200);
    expect(second.json().cards[0].id).not.toBe(first.json().cards[0].id);
    expectContract('cards_search', await f.human('GET', '/cards?limit=abc'), 400);
    expectContract('cards_search', await f.human('GET', '/cards?limit=0'), 400);
    expectContract('cards_search', await f.human('GET', '/cards?layer=bogus'), 400);
    expectContract('cards_search', await f.human('GET', '/cards?other=1'), 400);
    expectContract('cards_search', await f.raw({ method: 'GET', url: '/cards' }), 401);
  });
  it('card_get returns a card, 404 for unknown and for a card the gate denies', async () => {
    expectContract('card_get', await f.human('GET', `/cards/${f.ids.evPrivate}`), 200);
    expectContract('card_get', await f.agent('scripted', 'GET', `/cards/${f.ids.evPublic}`), 200);
    expectContract('card_get', await f.agent('scripted', 'GET', `/cards/${f.ids.evPrivate}`), 404);
    expectContract('card_get', await f.human('GET', '/cards/01ARZ3NDEKTSV4RRFFQ69G5FAV'), 404);
    expectContract(
      'card_get',
      await f.raw({ method: 'GET', url: `/cards/${f.ids.evPublic}` }),
      401,
    );
  });
});

describe('stance_get and stance_save', () => {
  it('stance_get is 404 before any stance, stance_save stores it, stance_get returns it', async () => {
    expectContract('stance_get', await f.human('GET', `/cards/${f.ids.evLoose}/stance`), 404);
    const saved = await f.human('PUT', `/cards/${f.ids.evLoose}/stance`, {
      position: 'believed',
      weight: 2,
      note: 'synthetic note',
    });
    expectContract('stance_save', saved, 200);
    const again = await f.human('PUT', `/cards/${f.ids.evLoose}/stance`, {
      position: 'rejected',
      weight: 3,
    });
    expect(again.json().history).toHaveLength(1);
    const got = await f.human('GET', `/cards/${f.ids.evLoose}/stance`);
    expectContract('stance_get', got, 200);
    expect(got.json().position).toBe('rejected');
  });
  it('stance_save validates the body and the card', async () => {
    const url = `/cards/${f.ids.evLoose}/stance`;
    expectContract(
      'stance_save',
      await f.human('PUT', url, { position: 'believed', weight: 9 }),
      400,
    );
    expectContract('stance_save', await f.human('PUT', url, { position: 'x', weight: 1 }), 400);
    expectContract(
      'stance_save',
      await f.human('PUT', '/cards/01ARZ3NDEKTSV4RRFFQ69G5FAV/stance', {
        position: 'believed',
        weight: 1,
      }),
      404,
    );
  });
});

describe('context_package_get', () => {
  it('builds a screen package for the human', async () => {
    const res = await f.human('POST', '/context-packages', { worldId: f.worldId });
    expectContract('context_package_get', res, 200);
    expect(res.json().target).toBe('screen');
    expect(res.json().items.length).toBeGreaterThan(3);
  });
  it('rejects an invalid request (400) and an unknown transfer for a cloud connection (403)', async () => {
    expectContract('context_package_get', await f.human('POST', '/context-packages', {}), 400);
    expectContract(
      'context_package_get',
      await f.agent('cloud-scripted', 'POST', '/context-packages', {
        worldId: f.worldId,
        transferId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      }),
      403,
    );
  });
});

describe('context_package_get with a Lage', () => {
  const ask = (who: 'human' | string, body: unknown) =>
    who === 'human'
      ? f.human('POST', '/context-packages', body)
      : f.agent(who, 'POST', '/context-packages', body);
  let privateLage: string;
  it('a model cannot tell a Lage the gate does not clear from one that does not exist', async () => {
    const made = await f.human('POST', '/lagen', {
      title: 'Private Lage',
      worlds: [f.worldId],
      lage: emptyLage(),
    });
    privateLage = cardOf(made).id;
    const unknown = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    for (const who of ['scripted', 'cloud-scripted']) {
      const hidden = await ask(who, { worldId: f.worldId, lageId: privateLage });
      const missing = await ask(who, { worldId: f.worldId, lageId: unknown });
      expectContract('context_package_get', hidden, 400);
      expect(hidden.body).toBe(missing.body);
    }
    // the human sees their own Lage; a cleared Lage still works for both model classes
    expectContract(
      'context_package_get',
      await ask('human', { worldId: f.worldId, lageId: privateLage }),
      200,
    );
    expectContract(
      'context_package_get',
      await ask('scripted', { worldId: f.worldId, lageId: f.ids.lage }),
      200,
    );
    const cloud = await ask('cloud-scripted', { worldId: f.worldId, lageId: f.ids.lage });
    expectContract('context_package_get', cloud, 200);
    expect(cloud.json().confirmationRequired).toBeDefined();
  });
  it('the Lage must belong to the requested world, for every caller', async () => {
    const other = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
    for (const who of ['human', 'scripted', 'cloud-scripted']) {
      expectContract(
        'context_package_get',
        await ask(who, { worldId: other, lageId: f.ids.lage }),
        400,
      );
    }
  });
});

describe('rules_evaluate', () => {
  it('evaluates the rules on a Lage', async () => {
    const res = await f.human('POST', '/rules/evaluate', { lageId: f.ids.lage });
    expectContract('rules_evaluate', res, 200);
    expect(res.json().results.length).toBeGreaterThan(0);
  });
  it('answers 404 for an unknown Lage and 400 for a bad body', async () => {
    expectContract(
      'rules_evaluate',
      await f.human('POST', '/rules/evaluate', { lageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
      404,
    );
    expectContract('rules_evaluate', await f.human('POST', '/rules/evaluate', {}), 400);
  });
});

describe('proposal_create, proposal_list, proposal_accept, proposal_reject', () => {
  let proposal: Proposal;
  it('proposal_create makes a pending proposal authored by the agent token', async () => {
    const res = await f.agent('scripted', 'POST', '/proposals', {
      kind: 'place_card',
      payload: { lageId: f.ids.lage, cardId: f.ids.evLoose, x: 10, y: 20 },
      rationale: 'synthetic',
    });
    expectContract('proposal_create', res, 201);
    proposal = res.json();
    expect(proposal).toMatchObject({ author: 'agent:scripted', status: 'pending' });
  });
  it('proposal_create rejects a bad body (400)', async () => {
    const res = await f.agent('scripted', 'POST', '/proposals', {
      kind: 'place_card',
      payload: {},
    });
    expectContract('proposal_create', res, 400);
  });
  it('proposal_list lists and polls with changedSince', async () => {
    const res = await f.human('GET', '/proposals?status=pending');
    expectContract('proposal_list', res, 200);
    expect(res.json().proposals.map((p: Proposal) => p.id)).toContain(proposal.id);
    const cursor = res.json().nextCursor as string;
    const quiet = await f.agent('scripted', 'GET', `/proposals?changedSince=${cursor}`);
    expectContract('proposal_list', quiet, 200);
    expect(quiet.json().proposals).toEqual([]);
    expectContract('proposal_list', await f.human('GET', '/proposals?status=nope'), 400);
    expectContract('proposal_list', await f.human('GET', '/proposals?cursor=%%%'), 400);
  });
  it('proposal_accept writes the change and marks the proposal accepted', async () => {
    const res = await f.human('POST', `/proposals/${proposal.id}/accept`, {});
    expectContract('proposal_accept', res, 200);
    expect(res.json()).toMatchObject({ status: 'accepted', decidedBy: 'human' });
    const lage = await f.adapter.read(f.ids.lage);
    expect(lage?.lage?.cards.find((c) => c.id === f.ids.evLoose)).toMatchObject({ x: 10, y: 20 });
  });
  it('proposal_accept without a body works; a decided proposal is 409; unknown is 404', async () => {
    expectContract(
      'proposal_accept',
      await f.human('POST', `/proposals/${proposal.id}/accept`),
      409,
    );
    expectContract(
      'proposal_accept',
      await f.human('POST', '/proposals/01ARZ3NDEKTSV4RRFFQ69G5FAV/accept'),
      404,
    );
  });
  it('proposal_accept answers 409 and stays pending when the change cannot be applied', async () => {
    const created = await f.agent('scripted', 'POST', '/proposals', {
      kind: 'move_card',
      payload: { lageId: f.ids.lage, cardId: f.ids.evCopy, x: 1, y: 2 },
    });
    const res = await f.human('POST', `/proposals/${created.json().id}/accept`, {});
    expectContract('proposal_accept', res, 409);
    const listed = await f.human('GET', '/proposals?status=pending');
    expect(listed.json().proposals.map((p: Proposal) => p.id)).toContain(created.json().id);
  });
  it('proposal_reject rejects once; a second decision is 409; unknown is 404', async () => {
    const created = await f.agent('scripted', 'POST', '/proposals', {
      kind: 'comment',
      payload: { text: 'synthetic comment' },
    });
    const id = created.json().id as string;
    const res = await f.human('POST', `/proposals/${id}/reject`, { note: 'no' });
    expectContract('proposal_reject', res, 200);
    expect(res.json().status).toBe('rejected');
    expectContract('proposal_reject', await f.human('POST', `/proposals/${id}/reject`), 409);
    expectContract(
      'proposal_reject',
      await f.human('POST', '/proposals/01ARZ3NDEKTSV4RRFFQ69G5FAV/reject'),
      404,
    );
  });
});

describe('decision_create and decision_save', () => {
  let decision: Card;
  it('decision_create saves a decision authored by the human', async () => {
    const res = await f.human('POST', '/decisions', {
      format: 2,
      type: 'decision',
      title: 'Synthetic decision',
      sections: sections([f.ids.evPublic]),
    });
    expectContract('decision_create', res, 201);
    decision = cardOf(res);
    expect(decision.author).toBe('human');
  });
  it('decision_create rejects unknown cardsUsed and an incomplete body (400)', async () => {
    const draft = { format: 2, type: 'decision', title: 'D' };
    expectContract('decision_create', await f.human('POST', '/decisions', draft), 400);
    expectContract(
      'decision_create',
      await f.human('POST', '/decisions', {
        ...draft,
        sections: sections(['01ARZ3NDEKTSV4RRFFQ69G5FAV']),
      }),
      400,
    );
  });
  it('decision_save patches the decision; a stale hash is 409; unknown is 404', async () => {
    const changed = {
      ...decision,
      sections: { ...decision.sections, outcome: 'Synthetic outcome.' },
    };
    const res = await f.human('PUT', `/decisions/${decision.id}`, changed);
    expectContract('decision_save', res, 200);
    expect(cardOf(res).sections?.outcome).toBe('Synthetic outcome.');
    expectContract(
      'decision_save',
      await f.human('PUT', `/decisions/${decision.id}`, changed),
      409,
    );
    expectContract(
      'decision_save',
      await f.human('PUT', '/decisions/01ARZ3NDEKTSV4RRFFQ69G5FAV', {
        ...changed,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      }),
      404,
    );
    expectContract(
      'decision_save',
      await f.human('PUT', `/decisions/${decision.id}`, { x: 1 }),
      400,
    );
  });
});

describe('disclosure transfers', () => {
  const request = { question: 'Synthetic question?' };
  let transfer: DisclosureTransfer;
  it('disclosure_transfer_preview builds the envelope of cleared cards only', async () => {
    const res = await f.human('POST', '/disclosure/transfers', {
      connectorId: 'synthetic-cloud',
      purpose: 'context_package',
      request,
      cardIds: [f.ids.evPublic, f.ids.evPrivate],
    });
    expectContract('disclosure_transfer_preview', res, 201);
    transfer = res.json();
    expect(transfer.cardIds).toEqual([f.ids.evPublic]);
    expect(JSON.stringify(transfer)).not.toContain('PRIVATE-MARKER-TEXT');
  });
  it('disclosure_transfer_preview rejects unknown cards and an uncleared set (400)', async () => {
    const base = { connectorId: 'synthetic-cloud', purpose: 'context_package', request };
    expectContract(
      'disclosure_transfer_preview',
      await f.human('POST', '/disclosure/transfers', { ...base, cardIds: [f.ids.evPrivate] }),
      400,
    );
    expectContract(
      'disclosure_transfer_preview',
      await f.human('POST', '/disclosure/transfers', {
        ...base,
        cardIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      }),
      400,
    );
    expectContract(
      'disclosure_transfer_preview',
      await f.human('POST', '/disclosure/transfers', {}),
      400,
    );
  });
  it('disclosure_transfer_get shows the pending transfer', async () => {
    const res = await f.human('GET', `/disclosure/transfers/${transfer.transferId}`);
    expectContract('disclosure_transfer_get', res, 200);
    expect(res.json().payloadHash).toBe(transfer.payloadHash);
    expectContract(
      'disclosure_transfer_get',
      await f.human('GET', '/disclosure/transfers/01ARZ3NDEKTSV4RRFFQ69G5FAV'),
      404,
    );
  });
  it('disclosure_confirm: a wrong hash is 409, the right hash gives a single-use token, a repeat is 409', async () => {
    const url = `/disclosure/transfers/${transfer.transferId}/confirm`;
    const wrong = `sha256:${'0'.repeat(64)}`;
    expectContract('disclosure_confirm', await f.human('POST', url, { payloadHash: wrong }), 409);
    expectContract('disclosure_confirm', await f.human('POST', url, { bad: 1 }), 400);
    const ok = await f.human('POST', url, { payloadHash: transfer.payloadHash });
    expectContract('disclosure_confirm', ok, 200);
    expect(ok.json().token).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
    expectContract(
      'disclosure_confirm',
      await f.human('POST', url, { payloadHash: transfer.payloadHash }),
      409,
    );
    expectContract(
      'disclosure_confirm',
      await f.human('POST', '/disclosure/transfers/01ARZ3NDEKTSV4RRFFQ69G5FAV/confirm', {
        payloadHash: wrong,
      }),
      404,
    );
  });
  it('disclosure_confirm: an expired transfer is 410', async () => {
    const preview = await f.human('POST', '/disclosure/transfers', {
      connectorId: 'synthetic-cloud',
      purpose: 'context_package',
      request,
      cardIds: [f.ids.evPublic],
    });
    const t = preview.json() as DisclosureTransfer;
    clock += 6 * 60 * 1000;
    const res = await f.human('POST', `/disclosure/transfers/${t.transferId}/confirm`, {
      payloadHash: t.payloadHash,
    });
    expectContract('disclosure_confirm', res, 410);
  });
});

describe('storage errors become problems (ADR-0005)', () => {
  const cases: [StorageErrorCode, number][] = [
    ['not_found', 404],
    ['conflict', 409],
    ['invalid', 400],
    ['locked', 503],
  ];
  it.each(cases)('%s is %i, as problem+json without the adapter message', async (code, status) => {
    const spy = vi
      .spyOn(f.adapter, 'read')
      .mockRejectedValue(new StorageError(code, 'SECRET-CARD-TEXT in the message'));
    try {
      const res = await f.human('GET', `/cards/${f.ids.evPublic}`);
      expect(res.statusCode).toBe(status);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).not.toContain('SECRET-CARD-TEXT');
      expect(res.json().status).toBe(status);
      if (status === 503) expect(res.headers['retry-after']).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
  it('a failure that is not a StorageError stays a 500 without detail', async () => {
    const spy = vi.spyOn(f.adapter, 'read').mockRejectedValue(new Error('disk exploded: SECRET'));
    try {
      const res = await f.human('GET', `/cards/${f.ids.evPublic}`);
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain('SECRET');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('contract coverage', () => {
  it('has a test for every operation of the OpenAPI contract', () => {
    const all = loadOperations().map((o) => o.id);
    expect(all.length).toBeGreaterThanOrEqual(19);
    expect(all.filter((id) => !covered.has(id))).toEqual([]);
  });
});
