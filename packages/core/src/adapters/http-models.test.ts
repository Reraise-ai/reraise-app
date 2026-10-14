// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it, vi } from 'vitest';
import type { Card, ContextPackage, DisclosureRelease } from '../generated/contracts.js';
import {
  CLOUD_CHAT_ENGINE,
  createCloudChatModel,
  createDecisionStub,
  createOllamaModel,
  DECISION_STUB_ENGINE,
  DEFAULT_CLOUD_MODEL,
  DEFAULT_OLLAMA_MODEL,
  ModelCallError,
  OLLAMA_ENGINE,
} from './http-models.js';
import type { ModelConnector } from './model.js';

const ID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ID_B = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const HASH = `sha256:${'ab'.repeat(32)}`;
const STANCE = 'STANCE-MARKER';
const KEY = 'synthetic-key';

function card(id: string, title: string, body = 'Synthetic body.'): Card {
  return {
    id,
    format: 2,
    type: 'claim',
    title,
    body,
    source: 'https://example.invalid/report',
    author: 'human',
    visibility: 'private',
  } as Card;
}

function pkg(cards: Card[], target: ContextPackage['target'] = 'local_model'): ContextPackage {
  return {
    id: ID_A,
    target,
    worldId: ID_A,
    createdAt: '2026-10-14T00:00:00.000Z',
    items: cards.map((item) => ({
      card: item,
      provenance: {
        uri: 'wb:00000000-0000-4000-8000-000000000001/a',
        originRoot: 'a',
        originKnown: true,
      },
      gate: { decision: 'allow', reason: 'cleared' },
      stance: {
        cardId: item.id,
        position: 'rejected',
        weight: 1,
        note: STANCE,
        updatedAt: '2026-10-14T00:00:00.000Z',
        history: [],
      },
    })),
    independence: { findings: cards.length, origins: 1 },
    pendingProposals: [],
    withheld: 0,
  } as ContextPackage;
}

function release(cards: Card[]): DisclosureRelease {
  return {
    confirmation: {
      transferId: ID_A,
      payloadHash: HASH,
      cardIds: cards.map((item) => item.id),
      confirmedAt: '2026-10-14T00:00:00.000Z',
    },
    objects: cards,
  };
}

function ok(json: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })) as typeof fetch;
}

function sent(fetchImpl: typeof fetch): { url: string; init: RequestInit } {
  const call = vi.mocked(fetchImpl).mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  return { url: String(call[0]), init: call[1] as RequestInit };
}

describe('model connectors', () => {
  it('refuses an address that is not https or loopback, and a URL that carries a secret', () => {
    const fetchImpl = ok({});
    expect(() =>
      createOllamaModel({ baseUrl: 'http://example.invalid', fetch: fetchImpl }),
    ).toThrow(/https/);
    expect(() =>
      createCloudChatModel({ baseUrl: 'https://user:secret@example.invalid', fetch: fetchImpl }),
    ).toThrow(/credentials/);
    expect(() => createDecisionStub({ baseUrl: 'not a url', fetch: fetchImpl })).toThrow(/URL/);
  });

  it('asks Ollama on loopback and returns the answer as a comment proposal', async () => {
    const fetchImpl = ok({ message: { content: '  Synthetic local answer.  ' } });
    const model = createOllamaModel({ fetch: fetchImpl });
    const answer = await model.ask(pkg([card(ID_A, 'Public claim')]), 'What is claimed?');
    expect(model.engine).toBe(OLLAMA_ENGINE);
    expect(model.target).toBe('local_model');
    expect(answer.text).toBe('Synthetic local answer.');
    expect(answer.proposals).toEqual([
      { kind: 'comment', payload: { text: 'Synthetic local answer.' } },
    ]);
    const { url, init } = sent(fetchImpl);
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init.redirect).toBe('error');
    expect(init.headers).not.toHaveProperty('authorization');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      messages: { content: string }[];
    };
    expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(body.stream).toBe(false);
    expect(body.messages[0]?.content).toContain('Public claim');
    expect(body.messages[0]?.content).toContain('What is claimed?');
    expect(body.messages[0]?.content).not.toContain(STANCE);
    expect(body.messages[0]?.content).not.toContain('private');
  });

  it('hides a failed Ollama body and rejects an answer that is not text', async () => {
    const secret = 'SECRET-BODY';
    const failing = vi.fn(async () => new Response(secret, { status: 500 })) as typeof fetch;
    await expect(
      createOllamaModel({ fetch: failing, baseUrl: 'http://localhost:11434' }).ask(
        pkg([card(ID_A, 'Public claim')]),
        'What is claimed?',
      ),
    ).rejects.toThrow(new ModelCallError('http_error'));
    expect(new ModelCallError('http_error').message).not.toContain(secret);

    const weird = ok({ message: { content: { leaked: secret } } });
    await expect(
      createOllamaModel({ fetch: weird }).ask(pkg([card(ID_A, 'Public claim')]), 'Q?'),
    ).rejects.toThrow(/could not be read/);
    expect(vi.mocked(weird).mock.calls.length).toBe(1);
  });

  it('does not call a cloud model without a release of the same cards', async () => {
    const fetchImpl = ok({});
    const cloud = createCloudChatModel({
      baseUrl: 'https://models.example.invalid/gateway',
      apiKey: KEY,
      fetch: fetchImpl,
    });
    const pack = pkg([card(ID_A, 'PACKAGE-TITLE')], 'cloud_model');
    await expect(cloud.ask(pack, 'What is claimed?')).rejects.toThrow(/confirmed transfer/);
    await expect(
      cloud.ask(pack, 'What is claimed?', release([card(ID_B, 'Other')])),
    ).rejects.toThrow(/confirmed transfer/);
    expect(vi.mocked(fetchImpl).mock.calls).toEqual([]);
    const idle = createCloudChatModel({ fetch: fetchImpl });
    await expect(idle.ask(pack, 'What is claimed?', release([card(ID_A, 'x')]))).rejects.toThrow(
      /not configured/,
    );
    expect(vi.mocked(fetchImpl).mock.calls).toEqual([]);
  });

  it('sends a cloud chat only the confirmed cards and returns a proposal', async () => {
    const fetchImpl = ok({ choices: [{ message: { content: 'Synthetic cloud answer.' } }] });
    const cloud: ModelConnector = createCloudChatModel({
      baseUrl: 'https://models.example.invalid/gateway',
      apiKey: KEY,
      fetch: fetchImpl,
    });
    const confirmed = card(ID_A, 'RELEASE-TITLE');
    const answer = await cloud.ask(
      pkg([card(ID_A, 'PACKAGE-TITLE')], 'cloud_model'),
      'What is claimed?',
      release([confirmed]),
    );
    expect(cloud.engine).toBe(CLOUD_CHAT_ENGINE);
    expect(answer.proposals[0]).toMatchObject({
      kind: 'comment',
      payload: { text: 'Synthetic cloud answer.' },
    });
    const { url, init } = sent(fetchImpl);
    expect(url).toBe('https://models.example.invalid/gateway/v1/chat/completions');
    expect((init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: { content: string }[];
    };
    expect(body.model).toBe(DEFAULT_CLOUD_MODEL);
    expect(body.messages[0]?.content).toContain('RELEASE-TITLE');
    expect(body.messages[0]?.content).not.toContain('PACKAGE-TITLE');
    expect(body.messages[0]?.content).not.toContain(STANCE);
    expect(body.messages[0]?.content).not.toContain(KEY);
  });

  it('asks the decision stub with the question and the confirmed state', async () => {
    const fetchImpl = ok({ answer: 'Synthetic decision.' });
    const stub = createDecisionStub({
      baseUrl: 'http://127.0.0.1:9',
      fetch: fetchImpl,
    });
    const answer = await stub.ask(
      pkg([card(ID_A, 'Released claim')], 'cloud_model'),
      'Which option?',
      release([card(ID_A, 'Released claim')]),
    );
    expect(stub.engine).toBe(DECISION_STUB_ENGINE);
    expect(stub.target).toBe('cloud_model');
    expect(answer.text).toBe('Synthetic decision.');
    const { url, init } = sent(fetchImpl);
    expect(url).toBe('http://127.0.0.1:9/v1/decide');
    expect(init.headers).not.toHaveProperty('authorization');
    const body = JSON.parse(String(init.body)) as { question: string; state: string };
    expect(body.question).toBe('Which option?');
    expect(body.state).toContain('Released claim');
    expect(body.state).not.toContain(STANCE);

    const quiet = createDecisionStub({ fetch: fetchImpl });
    await expect(quiet.ask(pkg([card(ID_A, 'x')], 'cloud_model'), 'Q?')).rejects.toThrow(
      /not configured/,
    );
  });

  it('rejects an oversized declared body and a prompt that does not fit', async () => {
    const huge = vi.fn(
      async () => new Response('{}', { status: 200, headers: { 'content-length': '2000000' } }),
    ) as typeof fetch;
    await expect(
      createOllamaModel({ fetch: huge }).ask(pkg([card(ID_A, 'Public claim')]), 'Q?'),
    ).rejects.toThrow(/could not be read/);

    const fetchImpl = ok({ message: { content: 'no' } });
    await expect(
      createOllamaModel({ fetch: fetchImpl }).ask(pkg([card(ID_A, 'x'.repeat(13_000))]), 'Q?'),
    ).rejects.toThrow(/too large/);
    expect(vi.mocked(fetchImpl).mock.calls).toEqual([]);
  });
});
