// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// model_ask: Ollama sees only cards the gate clears for a local model. A cloud model and
// the decision stub send nothing until the human confirms that transfer, and a private
// card stays out of both the preview and the request.

import type {
  Card,
  DisclosureConfirmation,
  DisclosureTransfer,
  ModelAskResult,
} from '@worldbuilder/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { expectContract, makeFixture, PRIVATE_TEXT, type Fixture } from './test-helpers.js';

const STANCE = 'STANCE-MARKER';

function callsOf(fetchImpl: typeof fetch): { url: string; body: string; auth: string }[] {
  return vi.mocked(fetchImpl).mock.calls.map((call) => {
    const init = call[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    return {
      url: String(call[0]),
      body: String(init?.body ?? ''),
      auth: headers?.['authorization'] ?? '',
    };
  });
}

describe('model_ask', () => {
  let f: Fixture;
  const fetchImpl = vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith('/api/chat')) {
      return new Response(JSON.stringify({ message: { content: 'Synthetic local answer.' } }), {
        status: 200,
      });
    }
    if (href.endsWith('/v1/decide')) {
      return new Response(JSON.stringify({ answer: 'Synthetic decision.' }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Synthetic cloud answer.' } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  beforeAll(async () => {
    f = await makeFixture({
      models: {
        fetch: fetchImpl,
        cloud: { baseUrl: 'http://127.0.0.1:9', apiKey: 'synthetic-key' },
        decision: { baseUrl: 'http://127.0.0.1:9' },
      },
    });
    const got = await f.human('GET', `/lagen/${f.ids.lage}`);
    const card = got.json() as Card;
    const next = {
      ...card.lage!,
      version: card.lage!.version + 1,
      cards: [...card.lage!.cards, { id: f.ids.evPrivate, x: 1, y: 1 }],
    };
    expectContract('lage_save', await f.human('PUT', `/lagen/${f.ids.lage}`, next), 200);
    expectContract(
      'stance_save',
      await f.human('PUT', `/cards/${f.ids.evPublic}/stance`, {
        position: 'rejected',
        weight: 1,
        note: STANCE,
      }),
      200,
    );
  });
  afterAll(async () => {
    await f.close();
  });

  it('asks Ollama with the cleared card only', async () => {
    vi.mocked(fetchImpl).mockClear();
    const res = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
      engine: 'ollama',
      question: 'What is claimed?',
    });
    expectContract('model_ask', res, 200);
    const body = res.json() as ModelAskResult;
    expect(body).toMatchObject({ status: 'proposed', engine: 'ollama' });
    const sent = callsOf(fetchImpl);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(sent[0]!.body).toContain('Synthetic public claim');
    expect(sent[0]!.body).not.toContain(PRIVATE_TEXT);
    expect(sent[0]!.body).not.toContain('Synthetic private note');
    expect(sent[0]!.body).not.toContain(STANCE);
    expect(sent[0]!.auth).toBe('');
  });

  it('previews a cloud call, then sends the confirmed cards once', async () => {
    vi.mocked(fetchImpl).mockClear();
    const first = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
      engine: 'cloud-chat',
      question: 'What is claimed?',
    });
    expectContract('model_ask', first, 200);
    const preview = first.json() as ModelAskResult;
    expect(preview.status).toBe('confirmation_required');
    if (preview.status !== 'confirmation_required') return;
    const transfer = preview.transfer as DisclosureTransfer;
    expect(transfer.cardIds).toEqual([f.ids.evPublic]);
    expect(JSON.stringify(transfer)).not.toContain(PRIVATE_TEXT);
    expect(callsOf(fetchImpl)).toEqual([]);

    const changed = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
      engine: 'cloud-chat',
      question: 'A different question?',
      transferId: transfer.transferId,
      confirmationToken: 'a'.repeat(22),
    });
    expectContract('model_ask', changed, 409);
    expect(callsOf(fetchImpl)).toEqual([]);

    const confirm = await f.human('POST', `/disclosure/transfers/${transfer.transferId}/confirm`, {
      payloadHash: transfer.payloadHash,
    });
    expectContract('disclosure_confirm', confirm, 200);
    const token = (confirm.json() as DisclosureConfirmation).token;
    expect(token).toBeTruthy();

    const sent = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
      engine: 'cloud-chat',
      question: 'What is claimed?',
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    expectContract('model_ask', sent, 200);
    const answer = sent.json() as ModelAskResult;
    expect(answer).toMatchObject({
      status: 'proposed',
      engine: 'cloud-chat',
      proposal: {
        author: 'agent:cloud-chat',
        kind: 'comment',
        payload: { text: 'Synthetic cloud answer.', lageId: f.ids.lage },
      },
    });
    const outbound = callsOf(fetchImpl);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.url).toBe('http://127.0.0.1:9/v1/chat/completions');
    expect(outbound[0]!.auth).toBe('Bearer synthetic-key');
    expect(outbound[0]!.body).toContain('Synthetic public claim');
    expect(outbound[0]!.body).not.toContain(PRIVATE_TEXT);
    expect(outbound[0]!.body).not.toContain(STANCE);
    expect(outbound[0]!.body).not.toContain('synthetic-key');

    const again = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
      engine: 'cloud-chat',
      question: 'What is claimed?',
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    expectContract('model_ask', again, 403);
    expect(callsOf(fetchImpl)).toHaveLength(1);
  });

  it('asks the decision stub only after confirmation', async () => {
    vi.mocked(fetchImpl).mockClear();
    const first = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
      engine: 'decision-stub',
      question: 'Which option?',
    });
    expectContract('model_ask', first, 200);
    expect(callsOf(fetchImpl)).toEqual([]);
    const transfer = (first.json() as ModelAskResult).transfer;
    expect(transfer).toBeDefined();
    if (!transfer) return;
    const confirm = await f.human('POST', `/disclosure/transfers/${transfer.transferId}/confirm`, {
      payloadHash: transfer.payloadHash,
    });
    const token = (confirm.json() as DisclosureConfirmation).token;
    const sent = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
      engine: 'decision-stub',
      question: 'Which option?',
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    expectContract('model_ask', sent, 200);
    expect((sent.json() as ModelAskResult).proposal).toMatchObject({
      author: 'agent:decision-stub',
      payload: { text: 'Synthetic decision.' },
    });
    const outbound = callsOf(fetchImpl);
    expect(outbound[0]!.url).toBe('http://127.0.0.1:9/v1/decide');
    expect(outbound[0]!.body).toContain('Which option?');
    expect(outbound[0]!.body).not.toContain(PRIVATE_TEXT);
  });

  it('refuses an unknown Lage and a model that was not given an address', async () => {
    expectContract(
      'model_ask',
      await f.human('POST', '/lagen/01ARZ3NDEKTSV4RRFFQ69G5FB2/model', {
        engine: 'ollama',
        question: 'What is claimed?',
      }),
      404,
    );
    const bare = await makeFixture({ models: { fetch: fetchImpl } });
    try {
      const res = await bare.human('POST', `/lagen/${bare.ids.lage}/model`, {
        engine: 'cloud-chat',
        question: 'What is claimed?',
      });
      expectContract('model_ask', res, 404);
      expect(res.body).not.toContain('Synthetic');
    } finally {
      await bare.close();
    }
  });

  it('reports a dead model without the response body', async () => {
    const secret = 'SECRET-BODY';
    const dead = vi.fn(async () => new Response(secret, { status: 500 })) as typeof fetch;
    const local = await makeFixture({ models: { fetch: dead } });
    try {
      const res = await local.human('POST', `/lagen/${local.ids.lage}/model`, {
        engine: 'ollama',
        question: 'What is claimed?',
      });
      expectContract('model_ask', res, 502);
      expect(res.body).not.toContain(secret);
    } finally {
      await local.close();
    }
  });
});
