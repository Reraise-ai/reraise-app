// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { ApiError, SESSION_HEADER, createClient } from './client.js';
import {
  BASE,
  CARDS,
  LAGE_ID,
  TOKEN,
  WORLD_ID,
  createMockApi,
  makeLage,
} from '../testing/mockApi.js';

function setup(token = TOKEN) {
  const api = createMockApi();
  return { api, client: createClient({ baseUrl: BASE, token, fetch: api.fetch }) };
}

describe('board client', () => {
  it('sends the session token in X-Worldbuilder-Session on every call', async () => {
    const { api, client } = setup();
    await client.world_list();
    await client.cards_search({ text: 'strait' });
    expect(SESSION_HEADER).toBe('X-Worldbuilder-Session');
    expect(api.calls.map((c) => c.headers['x-worldbuilder-session'])).toEqual([TOKEN, TOKEN]);
  });

  it('maps each operation to its method and path', async () => {
    const { api, client } = setup();
    const lage = makeLage();
    await client.world_list();
    await client.lage_get(LAGE_ID);
    await client.lage_save(LAGE_ID, { ...lage, version: 2 });
    const created = await client.lage_create({ title: 'New', worlds: [WORLD_ID], lage });
    await client.card_get(CARDS[0]!.id!);
    await client.stance_save(CARDS[0]!.id!, { position: 'believed', weight: 2 });
    await client.stance_get(CARDS[0]!.id!);
    await client.context_package_get({ worldId: WORLD_ID, lageId: LAGE_ID });
    await client.proposal_list({ lageId: LAGE_ID, changedSince: '5', limit: 200 });
    const t = await client.disclosure_transfer_preview({
      connectorId: 'c',
      purpose: 'context_package',
      request: {},
      cardIds: [CARDS[0]!.id!],
    });
    await client.disclosure_confirm(t.transferId, t.payloadHash);
    expect(created.id).toBeTruthy();
    expect(api.calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'GET /worlds',
      `GET /lagen/${LAGE_ID}`,
      `PUT /lagen/${LAGE_ID}`,
      'POST /lagen',
      `GET /cards/${CARDS[0]!.id}`,
      `PUT /cards/${CARDS[0]!.id}/stance`,
      `GET /cards/${CARDS[0]!.id}/stance`,
      'POST /context-packages',
      'GET /proposals',
      'POST /disclosure/transfers',
      `POST /disclosure/transfers/${t.transferId}/confirm`,
    ]);
    expect(api.calls[8]!.path).toBe(`/proposals?lageId=${LAGE_ID}&changedSince=5&limit=200`);
  });

  it('maps the level-1 operations to their paths and bodies', async () => {
    const { api, client } = setup();
    const trigger = { kind: 'manual' } as const;
    await expect(client.level1_get(LAGE_ID)).resolves.toMatchObject({ lageId: LAGE_ID });
    await client.level1_get(LAGE_ID, true);
    await client.level1_predict(LAGE_ID, { engine: 'local', trigger });
    await client
      .level1_escalate(LAGE_ID, CARDS[0]!.id!)
      .catch((e: unknown) => expect((e as ApiError).status).toBe(409));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /lagen/${LAGE_ID}/level1`,
      `GET /lagen/${LAGE_ID}/level1?explain=true`,
      `POST /lagen/${LAGE_ID}/level1`,
      `POST /lagen/${LAGE_ID}/level1/escalate`,
    ]);
    expect(api.calls[2]!.body).toEqual({ engine: 'local', trigger });
    expect(api.calls[3]!.body).toEqual({ playerCardId: CARDS[0]!.id });
    expect(api.calls.every((c) => c.headers['x-worldbuilder-session'] === TOKEN)).toBe(true);
  });

  it('decides proposals through the human-only endpoints', async () => {
    const { api, client } = setup();
    const p = api.addProposal({
      author: 'agent:scout',
      kind: 'place_card',
      payload: { lageId: LAGE_ID, cardId: CARDS[2]!.id!, x: 1, y: 2 },
    });
    const accepted = await client.proposal_accept(p.id, 'ok');
    expect(accepted.status).toBe('accepted');
    const q = api.addProposal({ author: 'agent:scout', kind: 'comment', payload: { text: 'hi' } });
    expect((await client.proposal_reject(q.id)).status).toBe('rejected');
    expect(api.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      `/proposals/${p.id}/accept`,
      `/proposals/${q.id}/reject`,
    ]);
    expect(api.calls[0]!.body).toEqual({ note: 'ok' });
  });

  it('creates a decision and saves a later outcome', async () => {
    const { api, client } = setup();
    const made = await client.decision_create({
      format: 2,
      type: 'decision',
      title: 'Synthetic decision',
      sections: {
        situation: 's',
        trigger: 't',
        conditions: 'c',
        facts: 'f',
        priorities: 'p',
        action: 'a',
        alternatives: 'al',
        exclusions: 'e',
        rationale: 'r',
        cardsUsed: [CARDS[0]!.id!],
        outcome: 'open',
      },
    });
    const saved = await client.decision_save(made.id!, {
      ...made,
      sections: { ...made.sections!, outcome: 'Done.' },
    });
    expect(saved.sections?.outcome).toBe('Done.');
    const page = await client.cards_search({ type: 'experience' });
    expect(page.cards.map((c) => c.title)).toEqual(['Experience: Synthetic decision']);
    expect(api.calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'POST /decisions',
      `PUT /decisions/${made.id}`,
      'GET /cards',
    ]);
  });

  it('omits empty query parameters', async () => {
    const { api, client } = setup();
    await client.cards_search({ text: '', type: 'lage' });
    expect(api.calls[0]!.path).toBe('/cards?type=lage');
  });

  it('turns a problem answer into an ApiError with status and detail', async () => {
    const { client } = setup();
    const err = await client.lage_save(LAGE_ID, makeLage({ version: 7 })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.isConflict).toBe(true);
    expect(err.problem?.title).toBe('version conflict');
  });

  it('reports 401 for a wrong token', async () => {
    const { client } = setup('wrong');
    const err = await client.world_list().catch((e) => e);
    expect(err.isUnauthorized).toBe(true);
  });

  it('reports a transport failure as status 0', async () => {
    const client = createClient({
      baseUrl: BASE,
      token: TOKEN,
      fetch: (() => Promise.reject(new Error('refused'))) as typeof fetch,
    });
    const err = await client.world_list().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toContain('refused');
  });

  it('survives a non-JSON error body', async () => {
    const client = createClient({
      baseUrl: BASE + '/',
      token: TOKEN,
      fetch: (async () => new Response('<html>', { status: 502 })) as typeof fetch,
    });
    const err = await client.world_list().catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.problem).toBeUndefined();
  });
});
