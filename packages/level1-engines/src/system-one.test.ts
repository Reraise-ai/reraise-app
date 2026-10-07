// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describeLevel1EngineConformance, releaseOf } from '@worldbuilder/conformance';
import type { Card } from '@worldbuilder/core';
import { describe, expect, it, vi } from 'vitest';
import {
  GENERIC_SYSTEM_ONE_PRESET,
  JEV_PRESET,
  Level1EngineError,
  SYSTEM_ONE_PRESETS,
  createJevAdapter,
  createSystemOneHttpAdapter,
  decideInputFrom,
  outputSchemaFor,
  renderCard,
} from './system-one.js';
import { ID, card, consortium, fixedNow, navy, report, requestOf } from './test-fixtures.js';

const BASE = 'https://decide.example.org/api';
const KEY = 'synthetic-test-key-1234';

type Body = {
  instruction: string;
  question: string;
  state: string;
  output_schema: {
    properties: Record<
      string,
      { properties: { predictedMove: { enum: string[] }; cardIds: { items: { enum: string[] } } } }
    >;
    required: string[];
  };
};

/** A fake service that answers from the output schema: the last enum option, confidence 0.7. */
function fakeService(answer?: (body: Body) => unknown) {
  const calls: { url: string; init: RequestInit; body: Body }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as Body;
    calls.push({ url: String(url), init, body });
    const output =
      answer?.(body) ??
      Object.fromEntries(
        Object.entries(body.output_schema.properties).map(([id, s]) => [
          id,
          {
            predictedMove: s.properties.predictedMove.enum.at(-1),
            confidence: 0.7,
            cardIds: [id],
          },
        ]),
      );
    return new Response(JSON.stringify({ output }), { status: 200 });
  }) as unknown as typeof fetch & { mock: unknown };
  return { fetchFn, calls };
}

const request = requestOf();

describeLevel1EngineConformance('system one adapter (generic preset, fake service)', () => ({
  engine: createSystemOneHttpAdapter({
    baseUrl: BASE,
    fetch: fakeService().fetchFn,
    now: fixedNow,
  }),
  request,
}));
describeLevel1EngineConformance('Jev adapter (fake service)', () => ({
  engine: createJevAdapter({ baseUrl: BASE, fetch: fakeService().fetchFn, now: fixedNow }),
  request,
}));

describe('the adapter sends only what a confirmed release holds', () => {
  const release = releaseOf(request.cards);

  it('declares itself a non-deterministic cloud engine with the preset engine id', () => {
    const a = createJevAdapter({ baseUrl: BASE, fetch: fakeService().fetchFn });
    expect([a.engine, a.target, a.deterministic]).toEqual(['jev', 'cloud_model', false]);
    const g = createSystemOneHttpAdapter({ baseUrl: BASE, fetch: fakeService().fetchFn });
    expect(g.engine).toBe('system-one');
    const own = createSystemOneHttpAdapter({
      baseUrl: BASE,
      fetch: fakeService().fetchFn,
      engine: 'acme-decide',
      preset: JEV_PRESET,
    });
    expect(own.engine).toBe('acme-decide');
    expect(Object.keys(SYSTEM_ONE_PRESETS)).toEqual(['generic-decide-v1', 'jev']);
  });

  it('rejects, without a single network call, when there is no release, raw cards, or a mismatch', async () => {
    const svc = fakeService();
    const a = createJevAdapter({ baseUrl: BASE, fetch: svc.fetchFn });
    const reject = async (r?: unknown) => {
      const e = await a.predict(request, r as never).then(
        () => undefined,
        (x: unknown) => x,
      );
      expect(e).toBeInstanceOf(Level1EngineError);
      expect((e as Level1EngineError).code).toBe('release_required');
    };
    await reject(undefined);
    await reject({ cards: request.cards }); // raw cards, not a release
    await reject({ objects: request.cards }); // no confirmation
    await reject(releaseOf(request.cards.slice(1))); // a card missing
    await reject(releaseOf([...request.cards].reverse())); // other order is another transfer
    const edited = { ...navy, title: 'Edited after confirmation' } as Card;
    await reject(releaseOf([edited, ...request.cards.slice(1)])); // content hash differs
    const tampered = structuredClone(release);
    tampered.confirmation.cardIds = [...tampered.confirmation.cardIds].reverse();
    await reject(tampered);
    const forged = structuredClone(release);
    (forged.objects[0] as { title: string }).title = 'Silently changed';
    await reject(forged); // content no longer matches its hash
    expect(svc.fetchFn).not.toHaveBeenCalled();
  });

  it('builds the request for POST /v1/decide with enum outputs and released content only', async () => {
    const svc = fakeService();
    const a = createJevAdapter({ baseUrl: BASE, fetch: svc.fetchFn, apiKey: KEY, now: fixedNow });
    await a.predict(request, release);
    expect(svc.calls).toHaveLength(1);
    const { url, init, body } = svc.calls[0]!;
    expect(url).toBe('https://decide.example.org/api/v1/decide');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    });
    expect(body.question).toBe(request.question);
    expect(body.output_schema.required).toEqual([ID.navy, ID.consortium]);
    expect(body.output_schema.properties[ID.navy]!.properties.predictedMove.enum).toEqual(
      request.players[0]!.moveOptions,
    );
    expect(body.output_schema.properties[ID.navy]!.properties.cardIds.items.enum).toEqual(
      request.cards.map((c) => c.id),
    );
    // content is there ...
    expect(body.state).toContain('Fast patrol boats able to escort or stop tankers at night');
    expect(body.state).toContain(`[card ${ID.report}]`);
    expect(body.state).toContain('User rule:');
    // ... store identity and private card metadata are not
    const wire = JSON.stringify(body);
    for (const secret of [
      'wb:',
      '45aaff12-777f',
      'externalId',
      'worlds',
      'visibility',
      'contentHash',
    ])
      expect(wire).not.toContain(secret);
    expect(wire).not.toContain(KEY);
  });

  it('leaves out the personality type and fields it does not need', () => {
    const c = card(ID.navy, {
      collection: 'actors',
      type: 'person',
      title: 'A fictional person',
      personalityType: { text: 'INTJ', source: ID.assessment },
      tags: ['secret-tag'],
      class: 'A',
      body: 'Public biography.',
    });
    const text = renderCard(c);
    expect(text).toContain('Public biography.');
    expect(text).not.toMatch(/INTJ|secret-tag|class/);
  });

  it('takes the credential from a function per call and sends none when there is none', async () => {
    const svc = fakeService();
    const key = vi.fn(async () => 'rotating-key');
    await createJevAdapter({ baseUrl: BASE, fetch: svc.fetchFn, apiKey: key }).predict(
      request,
      release,
    );
    expect(svc.calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer rotating-key' });
    const none = fakeService();
    await createJevAdapter({ baseUrl: BASE, fetch: none.fetchFn }).predict(request, release);
    expect(none.calls[0]!.init.headers).not.toHaveProperty('authorization');
  });

  it('refuses to send more state than the limit', async () => {
    const svc = fakeService();
    const a = createJevAdapter({ baseUrl: BASE, fetch: svc.fetchFn, maxStateChars: 100 });
    await expect(a.predict(request, release)).rejects.toMatchObject({ code: 'request_too_large' });
    expect(svc.fetchFn).not.toHaveBeenCalled();
  });

  it('predicts: typed move, the engine confidence and the cards it named, player card first', async () => {
    const svc = fakeService((body) =>
      Object.fromEntries(
        Object.entries(body.output_schema.properties).map(([id, s]) => [
          id,
          {
            predictedMove: s.properties.predictedMove.enum[1],
            confidence: 0.82,
            cardIds: [ID.report],
          },
        ]),
      ),
    );
    const p = await createJevAdapter({ baseUrl: BASE, fetch: svc.fetchFn, now: fixedNow }).predict(
      request,
      release,
    );
    expect(p.engine).toBe('jev');
    expect(p.players[0]).toEqual({
      playerCardId: ID.navy,
      moveOptions: request.players[0]!.moveOptions,
      predictedMove: 'Lift the restrictions',
      confidence: 0.82,
      cardIds: [ID.navy, ID.report],
    });
  });

  it('uses a top-level confidence for entries without one, and the player card when no ids come', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          confidence: 0.6,
          output: {
            [ID.navy]: { predictedMove: 'Lift the restrictions' },
            [ID.consortium]: { predictedMove: 'Delay sailings by two weeks', confidence: 0.9 },
          },
        }),
      )) as unknown as typeof fetch;
    const p = await createJevAdapter({ baseUrl: BASE, fetch: fetchFn }).predict(request, release);
    expect(p.players[0]).toMatchObject({ confidence: 0.6, cardIds: [ID.navy] });
    expect(p.players[1]).toMatchObject({ confidence: 0.9, cardIds: [ID.consortium] });
  });
});

describe('the adapter treats every answer as untrusted', () => {
  const release = releaseOf(request.cards);
  const ask = (response: () => Response | Promise<Response>) =>
    createJevAdapter({
      baseUrl: BASE,
      fetch: (async () => response()) as unknown as typeof fetch,
    }).predict(request, release);
  const answerWith =
    (patch: Record<string, unknown>, only: 'navy' | 'both' = 'both') =>
    () =>
      new Response(
        JSON.stringify({
          output: {
            [ID.navy]: { predictedMove: 'Lift the restrictions', confidence: 0.5, ...patch },
            ...(only === 'both'
              ? {
                  [ID.consortium]: {
                    predictedMove: 'Delay sailings by two weeks',
                    confidence: 0.5,
                  },
                }
              : {}),
          },
        }),
      );

  it.each([
    ['a move outside the options', { predictedMove: 'Nuke the strait' }],
    ['a move that is not text', { predictedMove: 3 }],
    ['a confidence above 1', { confidence: 1.2 }],
    ['a negative confidence', { confidence: -0.1 }],
    ['a confidence that is text', { confidence: '0.9' }],
    ['no confidence at all', { confidence: undefined }],
    ['a card id that was not released', { cardIds: [ID.stray] }],
    ['card ids that are not a list', { cardIds: ID.report }],
    ['card ids that are not text', { cardIds: [1] }],
  ])('rejects %s', async (_name, patch) => {
    await expect(ask(answerWith(patch))).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('rejects a missing player, a missing output and non-object entries', async () => {
    await expect(ask(answerWith({}, 'navy'))).rejects.toMatchObject({ code: 'bad_response' });
    await expect(ask(() => new Response('{"nothing":1}'))).rejects.toMatchObject({
      code: 'bad_response',
    });
    await expect(
      ask(() => new Response(JSON.stringify({ output: { [ID.navy]: 'x' } }))),
    ).rejects.toMatchObject({ code: 'bad_response' });
    await expect(ask(() => new Response('[1]'))).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('rejects an answer that is not JSON or too large', async () => {
    await expect(ask(() => new Response('<html>nope</html>'))).rejects.toMatchObject({
      code: 'bad_response',
    });
    await expect(ask(() => new Response('x'.repeat(1_000_001)))).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('reports an HTTP error by status only, without the body or the credential', async () => {
    const a = createJevAdapter({
      baseUrl: BASE,
      apiKey: KEY,
      fetch: (async () =>
        new Response('secret detail echo ' + KEY, { status: 503 })) as unknown as typeof fetch,
    });
    const e = (await a.predict(request, release).catch((x: unknown) => x)) as Level1EngineError;
    expect(e.code).toBe('http_error');
    expect(e.message).toContain('503');
    expect(e.message).not.toContain('secret detail');
    expect(e.message).not.toContain(KEY);
  });

  it('hides the cause of a failed request (it can carry the URL and headers)', async () => {
    const a = createJevAdapter({
      baseUrl: BASE,
      apiKey: KEY,
      fetch: (async () => {
        throw new Error(`connect ECONNREFUSED ${BASE} authorization: Bearer ${KEY}`);
      }) as unknown as typeof fetch,
    });
    const e = (await a.predict(request, release).catch((x: unknown) => x)) as Level1EngineError;
    expect(e.code).toBe('http_error');
    expect(e.message).not.toContain(KEY);
    expect(e.message).not.toContain('ECONNREFUSED');
  });

  it('ignores extra fields and does not let a __proto__ key through', async () => {
    const text = `{"output":{"${ID.navy}":{"predictedMove":"Lift the restrictions","confidence":0.5,"extra":1,"__proto__":{"x":1}},"${ID.consortium}":{"predictedMove":"Delay sailings by two weeks","confidence":0.5}},"__proto__":{"y":1}}`;
    const p = await ask(() => new Response(text));
    expect(p.players).toHaveLength(2);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('configuration', () => {
  const fetchFn = fakeService().fetchFn;

  it('accepts https and loopback http, a base path, and nothing else', () => {
    expect(() =>
      createJevAdapter({ baseUrl: 'http://localhost:8080', fetch: fetchFn }),
    ).not.toThrow();
    expect(() => createJevAdapter({ baseUrl: 'http://127.0.0.1/', fetch: fetchFn })).not.toThrow();
    expect(() => createJevAdapter({ baseUrl: 'http://example.org', fetch: fetchFn })).toThrow(
      /https/,
    );
    expect(() => createJevAdapter({ baseUrl: 'ftp://example.org', fetch: fetchFn })).toThrow(
      /https/,
    );
    expect(() => createJevAdapter({ baseUrl: 'not a url', fetch: fetchFn })).toThrow(/not a URL/);
    expect(() =>
      createJevAdapter({ baseUrl: 'https://user:pw@example.org', fetch: fetchFn }),
    ).toThrow(/credentials/);
    expect(() => createJevAdapter({ baseUrl: BASE, fetch: fetchFn, engine: 'Bad Id' })).toThrow(
      /engine id/,
    );
  });

  it('falls back to the global fetch when none is injected', () => {
    expect(() => createJevAdapter({ baseUrl: BASE })).not.toThrow();
  });

  it('builds an output schema and decision input from a release', () => {
    const release = releaseOf([navy, consortium, report]);
    const input = decideInputFrom(
      { ...request, players: [request.players[0]!], cards: [navy, consortium, report] },
      release,
    );
    expect(input.cardIds).toEqual([ID.navy, ID.consortium, ID.report]);
    expect(input.players[0]!.title).toBe(navy.title);
    const schema = outputSchemaFor(input) as { required: string[] };
    expect(schema.required).toEqual([ID.navy]);
    expect(GENERIC_SYSTEM_ONE_PRESET.buildBody(input)).toMatchObject({
      question: request.question,
    });
  });

  it('applies a custom preset (another provider with its own wire format)', async () => {
    const calls: unknown[] = [];
    const preset = {
      id: 'acme',
      defaultEngine: 'acme-decide',
      path: '/decide/v2',
      buildBody: (input: { question: string }) => ({ q: input.question }),
      readAnswers: () =>
        new Map([
          [ID.navy, { predictedMove: 'Lift the restrictions', confidence: 0.4 }],
          [ID.consortium, { predictedMove: 'Delay sailings by two weeks', confidence: 0.4 }],
        ]),
    };
    const f = (async (url: string, init: RequestInit) => {
      calls.push([String(url), init.body]);
      return new Response('{}');
    }) as unknown as typeof fetch;
    const a = createSystemOneHttpAdapter({ baseUrl: BASE, fetch: f, preset });
    const p = await a.predict(request, releaseOf(request.cards));
    expect(a.engine).toBe('acme-decide');
    expect(p.players[0]!.confidence).toBe(0.4);
    expect(calls).toEqual([[`${BASE}/decide/v2`, JSON.stringify({ q: request.question })]]);
  });
});
