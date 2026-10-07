// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Level 1 in the service (ADR-0035, ADR-0045): the request built from the cards of a Lage, the
// local engine, the cloud transfer flow, staleness and late answers, escalation, and what must
// never happen (a stance in a request, a prediction in a card or in the gate log, a send without
// a confirmed release).

import type {
  Card,
  DisclosureTransfer,
  Level1Engine,
  Level1Prediction,
  Level1PredictionRequest,
  Level1Result,
  Level1State,
} from '@worldbuilder/core';
import { createLocalRulesEngine, type LocalRulesEngine } from '@worldbuilder/level1-engines';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract, FIXTURE_RULES, makeFixture, type Fixture } from './test-helpers.js';

const ENGINES_YAML = `engines:
  - id: scripted-cloud
    preset: generic
    baseUrl: https://engine.example.invalid/
    enabled: true
    apiKeyFile: level1-scripted.key
    label: Scripted cloud engine
`;
const KEY = 'synthetic-key-0001';
const PRIVATE_NOTE = 'PRIVATE-LEVEL1-MARKER';

interface World {
  readonly navy: string;
  readonly consortium: string;
  readonly report: string;
  readonly assumption: string;
  readonly secret: string;
  readonly lage: string;
}

/** Two fictional actors, evidence, an assumption and a private note on one Lage. */
function seedWorld(f: Fixture, extra: Record<string, unknown> = {}): World {
  const seed = (fields: Record<string, unknown>) =>
    f.store.seed(f.store.nextExternalId(), {
      format: 2,
      author: 'human',
      worlds: [f.worldId],
      visibility: 'public',
      ...fields,
    });
  const report = seed({
    type: 'event',
    title: 'Wire report: night transit restrictions announced',
    layer: 'evidenced',
    source: 'https://example.org/wire/2026-09-14-transit-restrictions',
  });
  const navy = seed({
    collection: 'actors',
    type: 'organisation',
    title: 'Coastal navy (fictional)',
    layer: 'said',
    originSystem: 'Synthetic desk',
    interests: [{ text: 'Show control over the shipping lane', source: report }],
    moves: [{ text: 'Announced night transit restrictions', source: report }],
  });
  const consortium = seed({
    collection: 'actors',
    type: 'organisation',
    title: 'Tanker consortium (fictional)',
    layer: 'said',
    originSystem: 'Synthetic desk',
    interests: [
      { text: 'Keep delivery schedules for Q4', source: 'https://example.org/consortium/q4' },
    ],
    moves: [{ text: 'Delayed sailings by two weeks', source: report }],
  });
  const assumption = seed({
    type: 'assumption',
    title: 'Assumption: the navy lifts the restrictions after fee talks',
    layer: 'said',
    originSystem: 'Synthetic desk',
  });
  const secret = seed({
    type: 'claim',
    title: 'Private note',
    body: PRIVATE_NOTE,
    layer: 'said',
    originSystem: 'Synthetic desk',
    visibility: 'private',
  });
  const lage = seed({
    type: 'lage',
    title: 'Strait Lage',
    ...extra,
    lage: {
      question: 'Reroute laden tankers around the Cape?',
      options: ['Reroute', 'Hold course'],
      cards: [navy, consortium, report, assumption, secret].map((id, i) => ({
        id,
        x: i * 10,
        y: 0,
      })),
      seats: [{ name: 'Me', kind: 'human' }],
      edges: [],
      version: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  });
  return { navy, consortium, report, assumption, secret, lage };
}

const url = (w: World, tail = '') => `/lagen/${w.lage}/level1${tail}`;
const manual = { kind: 'manual' } as const;
const predict = (f: Fixture, w: World, body: Record<string, unknown> = {}) =>
  f.human('POST', url(w), { engine: 'local', trigger: manual, ...body });
const resultOf = (res: { json(): unknown }) => res.json() as Level1Result;

/** A recording copy of the built-in engine; `hold` makes the next call wait for `release()`. */
function recordingEngine() {
  const base = createLocalRulesEngine();
  const requests: Level1PredictionRequest[] = [];
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  const engine: LocalRulesEngine = {
    ...base,
    async predict(request) {
      requests.push(structuredClone(request));
      const wait = gate;
      gate = undefined;
      const answer = await base.predict(request);
      if (wait) await wait;
      return answer;
    },
  };
  return {
    engine,
    requests,
    hold() {
      gate = new Promise<void>((resolve) => (open = resolve));
    },
    release() {
      open?.();
    },
  };
}

/** A System One service that answers with the first option of every player. */
function cloudStub(options: { status?: number; body?: string } = {}) {
  const calls: { url: string; auth: string | null; body: string }[] = [];
  const stub = (async (input: unknown, init?: { body?: unknown; headers?: unknown }) => {
    const headers = new Headers(init?.headers as Record<string, string>);
    const body = String(init?.body ?? '');
    calls.push({ url: String(input), auth: headers.get('authorization'), body });
    if (options.status !== undefined) {
      return new Response(options.body ?? 'nope', { status: options.status });
    }
    const schema = (JSON.parse(body) as { output_schema: { properties: Record<string, never> } })
      .output_schema;
    const output = Object.fromEntries(
      Object.entries(schema.properties).map(([id, p]) => [
        id,
        {
          predictedMove: (p as { properties: { predictedMove: { enum: string[] } } }).properties
            .predictedMove.enum[0],
          confidence: 0.6,
        },
      ]),
    );
    return new Response(JSON.stringify({ output }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: stub, calls };
}

const open: Fixture[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()!.close();
});
async function fixture(options: Parameters<typeof makeFixture>[0] = {}): Promise<Fixture> {
  const f = await makeFixture(options);
  open.push(f);
  return f;
}

describe('level1_get and the local engine', () => {
  it('lists the built-in engine and Jev as unavailable, and has no prediction yet', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const res = await f.human('GET', url(w));
    expectContract('level1_get', res, 200);
    const state = res.json() as Level1State;
    expect(state.prediction).toBeUndefined();
    expect(state.engines.map((e) => [e.engine, e.available, e.target])).toEqual([
      ['local-rules', true, 'local_model'],
      ['jev', false, 'cloud_model'],
    ]);
    expect(state.engines[1]?.reason).toBe('not configured');
  });

  it('predicts for every actor on the Lage and nothing else', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const res = await predict(f, w);
    expectContract('level1_predict', res, 200);
    const out = resultOf(res);
    expect(out.status).toBe('predicted');
    const prediction = out.prediction as Level1Prediction;
    expect(prediction.engine).toBe('local-rules');
    expect(prediction.players.map((p) => p.playerCardId)).toEqual([w.navy, w.consortium]);
    for (const p of prediction.players) {
      expect(p.moveOptions).toContain(p.predictedMove);
      expect(p.cardIds[0]).toBe(p.playerCardId);
    }
    // The navy's past move is the first option and wins on behaviour.
    expect(prediction.players[0]?.predictedMove).toBe('Announced night transit restrictions');
  });

  it('is deterministic: the same board gives the same prediction apart from predictedAt', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const a = resultOf(await predict(f, w)).prediction as Level1Prediction;
    const b = resultOf(await predict(f, w)).prediction as Level1Prediction;
    expect({ ...a, predictedAt: '' }).toEqual({ ...b, predictedAt: '' });
    expect(b.requestHash).toBe(a.requestHash);
  });

  it('keeps the latest prediction and shows it as current until the board changes', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    expect(((await f.human('GET', url(w))).json() as Level1State).prediction).toBeUndefined();
    const made = resultOf(await predict(f, w)).prediction as Level1Prediction;
    const state = (await f.human('GET', url(w))).json() as Level1State;
    expect(state.prediction).toEqual(made);
    expect(state.stale).toBe(false);
  });

  it('answers no_players for a Lage without an actor, and for an actor the gate hides', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const empty = f.store.seed(f.store.nextExternalId(), {
      format: 2,
      author: 'human',
      worlds: [f.worldId],
      type: 'lage',
      title: 'Empty',
      lage: {
        question: 'Q?',
        options: [],
        cards: [{ id: w.report, x: 0, y: 0 }],
        seats: [],
        edges: [],
        version: 1,
        updatedAt: '2026-01-01T00:00:00Z',
      },
    });
    const res = await f.human('POST', `/lagen/${empty}/level1`, {
      engine: 'local',
      trigger: manual,
    });
    expectContract('level1_predict', res, 200);
    expect(resultOf(res).status).toBe('no_players');

    const g = await fixture({
      rules: `${FIXTURE_RULES}  - { id: hide-actors, effect: deny, targets: [screen], match: { type: [organisation] } }\n`,
    });
    const hidden = seedWorld(g);
    expect(resultOf(await predict(g, hidden)).status).toBe('no_players');
  });

  it('returns 404 for an unknown Lage and 400 for a trigger that does not fit', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const missing = '01M1F21G80R816A1T0V2P6RACH';
    expectContract(
      'level1_predict',
      await f.human('POST', `/lagen/${missing}/level1`, { engine: 'local', trigger: manual }),
      404,
    );
    expectContract('level1_get', await f.human('GET', `/lagen/${missing}/level1`), 404);
    expectContract(
      'level1_predict',
      await predict(f, w, { trigger: { kind: 'assumption_changed' } }),
      400,
    );
    expectContract('level1_predict', await predict(f, w, { engine: 'nope' }), 404);
  });
});

describe('the request', () => {
  it('holds the cleared cards and the rule cards of the Lage, never a stance or a private card', async () => {
    const rec = recordingEngine();
    const f = await fixture({ level1: { localEngine: rec.engine } });
    const w = seedWorld(f);
    const seed = (fields: Record<string, unknown>) =>
      f.store.seed(f.store.nextExternalId(), {
        format: 2,
        author: 'human',
        visibility: 'public',
        ...fields,
      });
    const rule = seed({
      type: 'rule',
      title: 'Prefer the Cape',
      worlds: [f.worldId],
      rule: { when: [{ kind: 'card_on_lage', card: w.report }], then: 'Reroute via the Cape' },
    });
    const foreignRule = seed({
      type: 'rule',
      title: 'Rule of another world',
      worlds: ['01M1E0000000000000000000A0'],
      rule: { when: [{ kind: 'card_on_lage', card: w.report }], then: 'Do something else' },
    });
    await f.human('PUT', `/cards/${w.navy}/stance`, {
      position: 'believed',
      weight: 3,
      note: 'STANCE-NOTE',
    });
    expect(resultOf(await predict(f, w)).status).toBe('predicted');
    const request = rec.requests[0]!;
    const ids = request.cards.map((c) => c.id);
    expect(ids).toContain(rule);
    expect(ids).not.toContain(foreignRule);
    // The screen sees the private note too (the user's own board).
    expect(ids).toContain(w.secret);
    expect(JSON.stringify(request)).not.toMatch(/STANCE-NOTE|"weight"/);
    expect(request.players.map((p) => p.moveOptions.length).every((n) => n >= 2)).toBe(true);
    expect(request.question).toBe('Reroute laden tankers around the Cape?');
  });

  it('leaves out an assumption the user rejected, and only that', async () => {
    const rec = recordingEngine();
    const f = await fixture({ level1: { localEngine: rec.engine } });
    const w = seedWorld(f);
    await predict(f, w);
    expect(rec.requests[0]?.cards.map((c) => c.id)).toContain(w.assumption);
    await f.human('PUT', `/cards/${w.assumption}/stance`, { position: 'rejected', weight: 1 });
    await predict(f, w);
    expect(rec.requests[1]?.cards.map((c) => c.id)).not.toContain(w.assumption);
    await f.human('PUT', `/cards/${w.assumption}/stance`, { position: 'undecided', weight: 1 });
    await predict(f, w);
    expect(rec.requests[2]?.cards.map((c) => c.id)).toContain(w.assumption);
  });

  it('records an assumption trigger only for assumption cards of the request', async () => {
    const rec = recordingEngine();
    const f = await fixture({ level1: { localEngine: rec.engine } });
    const w = seedWorld(f);
    await predict(f, w, {
      trigger: { kind: 'assumption_changed', cardIds: [w.assumption, w.navy] },
    });
    expect(rec.requests[0]?.trigger).toEqual({
      kind: 'assumption_changed',
      cardIds: [w.assumption],
    });
    await f.human('PUT', `/cards/${w.assumption}/stance`, { position: 'rejected', weight: 1 });
    await predict(f, w, { trigger: { kind: 'assumption_changed', cardIds: [w.assumption] } });
    expect(rec.requests[1]?.trigger).toEqual({ kind: 'manual' });
  });
});

describe('what-if and staleness', () => {
  it('turns stale after an assumption changes, runs again on the trigger and is current again', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const first = resultOf(await predict(f, w)).prediction as Level1Prediction;
    await f.human('PUT', `/cards/${w.assumption}/stance`, { position: 'rejected', weight: 1 });
    const stale = (await f.human('GET', url(w))).json() as Level1State;
    expect(stale.stale).toBe(true);
    expect(stale.prediction).toEqual(first);

    const rerun = resultOf(
      await predict(f, w, { trigger: { kind: 'assumption_changed', cardIds: [w.assumption] } }),
    );
    expect(rerun.status).toBe('predicted');
    const second = rerun.prediction as Level1Prediction;
    expect(second.requestHash).not.toBe(first.requestHash);
    expect(((await f.human('GET', url(w))).json() as Level1State).stale).toBe(false);

    // Undoing the change makes the board, and so the request hash, the one of the first run.
    await f.human('PUT', `/cards/${w.assumption}/stance`, { position: 'believed', weight: 1 });
    expect(((await f.human('GET', url(w))).json() as Level1State).stale).toBe(true);
    const again = resultOf(await predict(f, w)).prediction as Level1Prediction;
    expect(again.requestHash).toBe(first.requestHash);
  });

  it('turns stale when the content of a card changes, and the trigger alone changes nothing', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    resultOf(await predict(f, w, { trigger: { kind: 'lage_opened' } }));
    expect(((await f.human('GET', url(w))).json() as Level1State).stale).toBe(false);
    await f.adapter.patch(w.assumption, { body: 'The talks fail.' });
    expect(((await f.human('GET', url(w))).json() as Level1State).stale).toBe(true);
  });

  it('does not run the engine again when the stored prediction still describes the board', async () => {
    const rec = recordingEngine();
    const f = await fixture({ level1: { localEngine: rec.engine } });
    const w = seedWorld(f);
    await predict(f, w);
    const out = resultOf(
      await predict(f, w, { trigger: { kind: 'assumption_changed', cardIds: [w.assumption] } }),
    );
    expect(out.status).toBe('predicted');
    expect(rec.requests).toHaveLength(1);
  });

  it('names the players whose move changed', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    await predict(f, w);
    // A rule of the user that names the navy changes its predicted move.
    f.store.seed(f.store.nextExternalId(), {
      format: 2,
      author: 'human',
      visibility: 'public',
      worlds: [f.worldId],
      type: 'rule',
      title: 'Navy lifts when talks succeed',
      rule: {
        when: [
          { kind: 'card_on_lage', card: w.navy },
          { kind: 'card_on_lage', card: w.assumption },
        ],
        then: 'Lift the restrictions entirely and reopen the lane',
      },
    });
    const out = resultOf(await predict(f, w));
    expect(out.status).toBe('predicted');
    for (const change of out.changes ?? []) expect(change.from).not.toBe(change.to);
  });

  it('drops a late answer: the call that is no longer the newest is superseded', async () => {
    const rec = recordingEngine();
    const f = await fixture({ level1: { localEngine: rec.engine } });
    const w = seedWorld(f);
    rec.hold();
    const slow = predict(f, w);
    await vi_waitFor(() => rec.requests.length === 1);
    const fast = await predict(f, w, { trigger: { kind: 'lage_opened' } });
    expect(resultOf(fast).status).toBe('predicted');
    rec.release();
    const late = resultOf(await slow);
    expect(late.status).toBe('superseded');
    expect(late.prediction).toBeUndefined();
    const state = (await f.human('GET', url(w))).json() as Level1State;
    expect(state.prediction?.trigger).toEqual({ kind: 'lage_opened' });
  });

  it('drops an answer for a board that changed while the engine ran', async () => {
    const rec = recordingEngine();
    const f = await fixture({ level1: { localEngine: rec.engine } });
    const w = seedWorld(f);
    rec.hold();
    const slow = predict(f, w);
    await vi_waitFor(() => rec.requests.length === 1);
    await f.human('PUT', `/cards/${w.assumption}/stance`, { position: 'rejected', weight: 1 });
    rec.release();
    expect(resultOf(await slow).status).toBe('superseded');
    expect(((await f.human('GET', url(w))).json() as Level1State).prediction).toBeUndefined();
  });

  it('gives the basis of the local engine on demand, only while the prediction is current', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    await predict(f, w);
    const plain = (await f.human('GET', url(w))).json() as Level1State;
    expect(plain.basis).toBeUndefined();
    const res = await f.human('GET', `${url(w)}?explain=true`);
    expectContract('level1_get', res, 200);
    const state = res.json() as Level1State;
    expect(state.basis).toMatchObject({ engine: 'local-rules' });
    await f.human('PUT', `/cards/${w.assumption}/stance`, { position: 'rejected', weight: 1 });
    const stale = (await f.human('GET', `${url(w)}?explain=true`)).json() as Level1State;
    expect(stale.stale).toBe(true);
    expect(stale.basis).toBeUndefined();
  });
});

async function vi_waitFor(test: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
}

describe('cloud engines', () => {
  async function cloud(engines = ENGINES_YAML, stub = cloudStub()) {
    const f = await fixture({
      level1: { fetch: stub.fetch },
      stateFiles: { 'level1-engines.yaml': engines, 'level1-scripted.key': `${KEY}\n` },
    });
    return { f, stub, w: seedWorld(f) };
  }
  const preview = async (f: Fixture, w: World, trigger: object = manual) =>
    f.human('POST', url(w), { engine: 'scripted-cloud', trigger });
  const confirm = async (f: Fixture, transfer: DisclosureTransfer) => {
    const res = await f.human('POST', `/disclosure/transfers/${transfer.transferId}/confirm`, {
      payloadHash: transfer.payloadHash,
    });
    expectContract('disclosure_confirm', res, 200);
    return (res.json() as { token: string }).token;
  };

  it('lists the configured engine, refuses an unknown one and an unconfigured Jev', async () => {
    const { f, w } = await cloud();
    const state = (await f.human('GET', url(w))).json() as Level1State;
    expect(state.engines.map((e) => [e.engine, e.available])).toEqual([
      ['local-rules', true],
      ['scripted-cloud', true],
      ['jev', false],
    ]);
    expectContract(
      'level1_predict',
      await f.human('POST', url(w), { engine: 'jev', trigger: manual }),
      409,
    );
    expectContract(
      'level1_predict',
      await f.human('POST', url(w), { engine: 'other', trigger: manual }),
      404,
    );
  });

  it('previews the whole envelope first and sends nothing', async () => {
    const { f, stub, w } = await cloud();
    const res = await preview(f, w);
    expectContract('level1_predict', res, 200);
    const out = resultOf(res);
    expect(out.status).toBe('confirmation_required');
    const transfer = (out as unknown as { transfer: DisclosureTransfer }).transfer;
    expect(transfer.purpose).toBe('level1');
    expect(transfer.preview.connectorId).toBe('scripted-cloud');
    expect(transfer.preview.request.question).toBe('Reroute laden tankers around the Cape?');
    expect(transfer.preview.request.options?.length).toBeGreaterThan(1);
    expect(transfer.preview.request.outputSchema).toBeDefined();
    // Only cards the rules clear for a cloud model: the private note is not in the envelope.
    expect(transfer.cardIds).not.toContain(w.secret);
    expect(JSON.stringify(transfer)).not.toContain(PRIVATE_NOTE);
    expect(transfer.cardIds).toEqual(expect.arrayContaining([w.navy, w.consortium]));
    expect(stub.calls).toHaveLength(0);
    expect(((await f.human('GET', url(w))).json() as Level1State).prediction).toBeUndefined();
  });

  it('refuses a send without a confirmed transfer and sends nothing', async () => {
    const { f, stub, w } = await cloud();
    const transfer = (resultOf(await preview(f, w)) as unknown as { transfer: DisclosureTransfer })
      .transfer;
    const forged = 'A'.repeat(43);
    const unconfirmed = await f.human('POST', url(w), {
      engine: 'scripted-cloud',
      trigger: manual,
      transferId: transfer.transferId,
      confirmationToken: forged,
    });
    expectContract('level1_predict', unconfirmed, 403);
    // A transfer of another purpose is no release for level 1.
    const other = (
      await f.human('POST', '/disclosure/transfers', {
        connectorId: 'scripted-cloud',
        purpose: 'context_package',
        request: {},
        cardIds: [w.navy],
      })
    ).json() as DisclosureTransfer;
    const token = await confirm(f, other);
    expectContract(
      'level1_predict',
      await f.human('POST', url(w), {
        engine: 'scripted-cloud',
        trigger: manual,
        transferId: other.transferId,
        confirmationToken: token,
      }),
      403,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it('the cloud engine itself refuses a request without a release', async () => {
    const { f, stub, w } = await cloud();
    const { registry } = f.service.app.services.level1;
    const found = await registry.resolve('scripted-cloud');
    expect(found.kind).toBe('ok');
    const engine = (found as { engine: Level1Engine }).engine;
    const built = await f.service.app.services.level1.build(w.lage, 'cloud_model', manual, false);
    await expect(engine.predict(built.request!)).rejects.toMatchObject({
      code: 'release_required',
    });
    expect(stub.calls).toHaveLength(0);
  });

  it('sends exactly the confirmed objects once, with the credential, and the token is spent', async () => {
    const { f, stub, w } = await cloud();
    const transfer = (resultOf(await preview(f, w)) as unknown as { transfer: DisclosureTransfer })
      .transfer;
    const token = await confirm(f, transfer);
    const body = {
      engine: 'scripted-cloud',
      trigger: manual,
      transferId: transfer.transferId,
      confirmationToken: token,
    };
    const res = await f.human('POST', url(w), body);
    expectContract('level1_predict', res, 200);
    const out = resultOf(res);
    expect(out.status).toBe('predicted');
    expect(out.prediction?.engine).toBe('scripted-cloud');
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.auth).toBe(`Bearer ${KEY}`);
    expect(stub.calls[0]?.url).toBe('https://engine.example.invalid/v1/decide');
    expect(stub.calls[0]?.body).not.toContain(PRIVATE_NOTE);
    expect(stub.calls[0]?.body).not.toMatch(/STANCE-NOTE|weight/);
    // Replaying the token fails and sends nothing more.
    expectContract('level1_predict', await f.human('POST', url(w), body), 403);
    expect(stub.calls).toHaveLength(1);
  });

  it('a card edited after the preview cannot be confirmed (409) and nothing is sent', async () => {
    const { f, stub, w } = await cloud();
    const transfer = (resultOf(await preview(f, w)) as unknown as { transfer: DisclosureTransfer })
      .transfer;
    await f.adapter.patch(w.assumption, { body: 'Changed after the preview.' });
    const res = await f.human('POST', `/disclosure/transfers/${transfer.transferId}/confirm`, {
      payloadHash: transfer.payloadHash,
    });
    expectContract('disclosure_confirm', res, 409);
    expect(stub.calls).toHaveLength(0);
  });

  it('a changed question after the confirmation is a 409 and sends nothing', async () => {
    const { f, stub, w } = await cloud();
    const transfer = (resultOf(await preview(f, w)) as unknown as { transfer: DisclosureTransfer })
      .transfer;
    const token = await confirm(f, transfer);
    const lage = (await f.human('GET', `/lagen/${w.lage}`)).json() as Card;
    const saved = await f.human('PUT', `/lagen/${w.lage}`, {
      ...lage.lage,
      question: 'Another question?',
      version: lage.lage!.version + 1,
    });
    expect(saved.statusCode).toBe(200);
    const res = await f.human('POST', url(w), {
      engine: 'scripted-cloud',
      trigger: manual,
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    expectContract('level1_predict', res, 409);
    expect(stub.calls).toHaveLength(0);
  });

  it('shows a cloud prediction as stale after a change and never re-runs by itself', async () => {
    const { f, stub, w } = await cloud();
    const transfer = (resultOf(await preview(f, w)) as unknown as { transfer: DisclosureTransfer })
      .transfer;
    const token = await confirm(f, transfer);
    await f.human('POST', url(w), {
      engine: 'scripted-cloud',
      trigger: manual,
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    await f.adapter.patch(w.assumption, { body: 'New facts.' });
    const state = (await f.human('GET', url(w))).json() as Level1State;
    expect(state.stale).toBe(true);
    // A what-if trigger for a cloud engine is a new preview, not a send.
    const again = resultOf(
      await preview(f, w, { kind: 'assumption_changed', cardIds: [w.assumption] }),
    );
    expect(again.status).toBe('confirmation_required');
    expect(stub.calls).toHaveLength(1);
  });

  it('reports an engine failure with fixed wording, never the answer or the credential', async () => {
    const stub = cloudStub({ status: 500, body: `${KEY} ${PRIVATE_NOTE}` });
    const { f, w } = await cloud(ENGINES_YAML, stub);
    const transfer = (resultOf(await preview(f, w)) as unknown as { transfer: DisclosureTransfer })
      .transfer;
    const token = await confirm(f, transfer);
    const res = await f.human('POST', url(w), {
      engine: 'scripted-cloud',
      trigger: manual,
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    expectContract('level1_predict', res, 502);
    expect(res.body).not.toContain(KEY);
    expect(res.body).not.toContain(PRIVATE_NOTE);
    expect(res.body).not.toContain('example.invalid');
  });

  it('keeps an engine unavailable when its credential file is readable by others', async () => {
    if (process.platform === 'win32') return;
    const { f, w } = await cloud();
    const { chmod } = await import('node:fs/promises');
    await chmod(path.join(f.stateDir, 'level1-scripted.key'), 0o644);
    const state = (await f.human('GET', url(w))).json() as Level1State;
    const engine = state.engines.find((e) => e.engine === 'scripted-cloud');
    expect(engine?.available).toBe(false);
    expect(engine?.reason).toMatch(/owner only/);
    expectContract('level1_predict', await preview(f, w), 409);
  });

  it('fails closed on an invalid registry file, a reserved id and a disabled engine', async () => {
    const bad = await cloud('engines: [{ id: x }]\n');
    const state = (await bad.f.human('GET', url(bad.w))).json() as Level1State;
    expect(state.engines.map((e) => e.engine)).toEqual(['local-rules', 'jev']);
    expect(state.engines[1]?.reason).toMatch(/invalid/);

    const reserved = await cloud(ENGINES_YAML.replace('id: scripted-cloud', 'id: local-rules'));
    const listed = (await reserved.f.human('GET', url(reserved.w))).json() as Level1State;
    expect(
      listed.engines.find((e) => e.engine === 'local-rules' && e.target === 'cloud_model')
        ?.available,
    ).toBe(false);

    const disabled = await cloud(ENGINES_YAML.replace('enabled: true', 'enabled: false'));
    const off = (await disabled.f.human('GET', url(disabled.w))).json() as Level1State;
    expect(off.engines.find((e) => e.engine === 'scripted-cloud')?.reason).toBe('disabled');
    expectContract('level1_predict', await preview(disabled.f, disabled.w), 409);
  });

  it('an engine id cannot be the name of an agent connection', async () => {
    const f = await fixture({
      agents: { 'scripted-cloud': 'local_model' },
      level1: { fetch: cloudStub().fetch },
      stateFiles: { 'level1-engines.yaml': ENGINES_YAML, 'level1-scripted.key': KEY },
    });
    const w = seedWorld(f);
    const state = (await f.human('GET', url(w))).json() as Level1State;
    expect(state.engines.find((e) => e.engine === 'scripted-cloud')?.reason).toMatch(
      /agent connection/,
    );
  });

  it('answers no_players, and previews nothing, when the rules clear no actor for a cloud engine', async () => {
    const f = await fixture({
      rules: 'rules:\n  - { id: screen-all, effect: allow, targets: [screen], match: {} }\n',
      level1: { fetch: cloudStub().fetch },
      stateFiles: { 'level1-engines.yaml': ENGINES_YAML, 'level1-scripted.key': KEY },
    });
    const w = seedWorld(f);
    const none = await preview(f, w);
    expectContract('level1_predict', none, 200);
    expect(resultOf(none).status).toBe('no_players');
  });
});

describe('escalation to a level-2 board', () => {
  it('creates a Lage for one player, linked to the source, without the estimate', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const before = (await f.human('GET', `/lagen/${w.lage}`)).json() as Card;
    const prediction = resultOf(await predict(f, w)).prediction as Level1Prediction;
    const res = await f.human('POST', url(w, '/escalate'), { playerCardId: w.navy });
    expectContract('level1_escalate', res, 201);
    const created = res.json() as Card;
    expect(created.type).toBe('lage');
    expect(created.author).toBe('human');
    expect(created.edges).toEqual([{ target: w.lage, kind: 'based_on', by: 'human' }]);
    expect(created.lage?.question).toContain('Coastal navy');
    expect(created.lage?.options).toEqual(prediction.players[0]?.moveOptions);
    expect(created.lage?.cards[0]?.id).toBe(w.navy);
    expect(created.worlds).toEqual([f.worldId]);
    const text = JSON.stringify(created);
    expect(text).not.toContain(prediction.requestHash);
    expect(text).not.toContain(String(prediction.players[0]?.confidence));
    // The source Lage is untouched.
    const after = (await f.human('GET', `/lagen/${w.lage}`)).json() as Card;
    expect(after.lage?.version).toBe(before.lage?.version);
    expect(after.contentHash).toBe(before.contentHash);
  });

  it('needs a current prediction and a player of it', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    expectContract(
      'level1_escalate',
      await f.human('POST', url(w, '/escalate'), { playerCardId: w.navy }),
      409,
    );
    await predict(f, w);
    expectContract(
      'level1_escalate',
      await f.human('POST', url(w, '/escalate'), { playerCardId: w.report }),
      404,
    );
    await f.adapter.patch(w.assumption, { body: 'Changed.' });
    expectContract(
      'level1_escalate',
      await f.human('POST', url(w, '/escalate'), { playerCardId: w.navy }),
      409,
    );
  });
});

describe('what never happens', () => {
  it('writes no prediction into a card, the store or the gate log', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const hashes = async () =>
      JSON.stringify([...f.store.cards.entries()].map(([id, c]) => [id, c.lines]).sort());
    const before = await hashes();
    const made = resultOf(await predict(f, w)).prediction as Level1Prediction;
    await f.human('GET', `${url(w)}?explain=true`);
    expect(await hashes()).toBe(before);
    const files = (await readdir(f.stateDir)).filter((n) => n.startsWith('gate-log'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = await readFile(path.join(f.stateDir, name), 'utf8');
      expect(text).not.toContain('predictedMove');
      expect(text).not.toContain(made.requestHash);
      expect(text).not.toContain(PRIVATE_NOTE);
      expect(text).not.toContain('Announced night transit');
    }
    // A context package of the world holds no prediction either.
    const pkg = await f.human('POST', '/context-packages', { worldId: f.worldId, lageId: w.lage });
    expect(pkg.body).not.toContain(made.requestHash);
  });

  it('is not reachable by an agent: the three operations are human-only', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const calls: [string, string, unknown][] = [
      ['GET', url(w), undefined],
      ['POST', url(w), { engine: 'local', trigger: manual }],
      ['POST', url(w, '/escalate'), { playerCardId: w.navy }],
    ];
    for (const [method, target, payload] of calls) {
      for (const agent of ['scripted', 'cloud-scripted']) {
        const res = await f.agent(agent, method, target, payload);
        expect(res.statusCode).toBe(403);
      }
    }
  });

  it('words no estimate as a verdict in any response', async () => {
    const f = await fixture();
    const w = seedWorld(f);
    const text = (await predict(f, w)).body + (await f.human('GET', `${url(w)}?explain=true`)).body;
    expect(text).not.toMatch(/verdict|recommend|the answer is|you should/i);
  });
});
