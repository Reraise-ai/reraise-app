// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Networked ModelConnectors (ADR-0005, ADR-0015). Ollama is the local model (catalogue 35).
// The cloud chat model speaks the OpenAI chat shape that LiteLLM serves (catalogue 34).
// The decision stub speaks POST /v1/decide. Each answer is a comment proposal. A cloud
// connector sends nothing unless the release lists exactly the package's cards, and then
// only id, title, body and source from those objects. fetch is injected; nothing here
// opens a connection by itself.

import type {
  Card,
  ContextPackage,
  DisclosureRelease,
  ModelAnswer,
} from '../generated/contracts.js';
import type { ModelConnector } from './model.js';

export const OLLAMA_ENGINE = 'ollama';
export const CLOUD_CHAT_ENGINE = 'cloud-chat';
export const DECISION_STUB_ENGINE = 'decision-stub';

/** Default Ollama model: one 8B model, the size the catalogue allows on the shared GPU. */
export const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b';
/** LiteLLM model alias until an operator sets another. */
export const DEFAULT_CLOUD_MODEL = 'cloud';

export type ModelCallCode =
  'release_required' | 'not_configured' | 'request_too_large' | 'http_error' | 'bad_response';

const TEXT: Readonly<Record<ModelCallCode, string>> = {
  release_required: 'a cloud model needs the confirmed transfer',
  not_configured: 'this model is not configured',
  request_too_large: 'the question and the cards are too large to send',
  http_error: 'the model did not answer',
  bad_response: 'the model answer could not be read',
};

/** A model failure. The message is one of the fixed lines above and carries no answer text. */
export class ModelCallError extends Error {
  constructor(readonly code: ModelCallCode) {
    super(TEXT[code]);
    this.name = 'ModelCallError';
  }
}

export interface OllamaModelOptions {
  /** Default `http://127.0.0.1:11434`. http is allowed only on a loopback address. */
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

export interface CloudChatModelOptions {
  /** Absent means the connector is present and refuses every call without a network request. */
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

export interface DecisionStubOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

const MAX_PROMPT_CHARS = 12_000;
const MAX_RESPONSE_BYTES = 1_000_000;
/** shortcut: answers longer than 4000 characters are cut; raise this when a real answer needs the rest. */
const ANSWER_CAP = 4_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function endpoint(baseUrl: string, path: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new TypeError('baseUrl is not a URL');
  }
  const loopback = LOOPBACK.has(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) {
    throw new TypeError('baseUrl must be https (http only on a loopback address)');
  }
  if (base.username || base.password) throw new TypeError('baseUrl must not carry credentials');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(path.replace(/^\//, ''), base).href;
}

function cardLines(cards: readonly Card[]): string {
  if (cards.length === 0) return 'No cards.';
  return cards
    .map((card) => {
      const lines = [`Card ${card.id}`, card.title];
      if (card.body) lines.push(card.body);
      if (card.source) lines.push(`Source: ${card.source}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

function prompt(question: string, cards: readonly Card[]): string {
  const text = `${question.trim()}\n\n${cardLines(cards)}`;
  if (text.length > MAX_PROMPT_CHARS) throw new ModelCallError('request_too_large');
  return text;
}

function comment(text: string): ModelAnswer {
  const trimmed = text.trim();
  if (trimmed === '' || !/\S/.test(trimmed)) throw new ModelCallError('bad_response');
  const body = trimmed.length > ANSWER_CAP ? trimmed.slice(0, ANSWER_CAP) : trimmed;
  return { text: body, proposals: [{ kind: 'comment', payload: { text: body } }] };
}

function sameIds(pkg: ContextPackage, release: DisclosureRelease): boolean {
  const want = pkg.items.map((item) => item.card.id).sort();
  const got = release.objects.map((card) => card.id).sort();
  return want.length > 0 && want.length === got.length && want.every((id, i) => id === got[i]);
}

/** Cards the cloud call may mention: the confirmed objects, and only when they are the package. */
function releasedCards(
  pkg: ContextPackage,
  release: DisclosureRelease | undefined,
): readonly Card[] {
  if (!release || !sameIds(pkg, release)) throw new ModelCallError('release_required');
  return release.objects;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ModelCallError('bad_response');
  }
  if (!response.body) throw new ModelCallError('bad_response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ModelCallError('bad_response');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function postJson(
  doFetch: typeof fetch,
  url: string,
  body: unknown,
  timeoutMs: number,
  apiKey?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ModelCallError('http_error');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ModelCallError('http_error');
  }
  try {
    return JSON.parse(await readCapped(response)) as unknown;
  } catch (e) {
    if (e instanceof ModelCallError) throw e;
    throw new ModelCallError('bad_response');
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function chatContent(json: unknown, pick: (record: Record<string, unknown>) => unknown): string {
  if (!isRecord(json)) throw new ModelCallError('bad_response');
  const content = pick(json);
  if (typeof content !== 'string') throw new ModelCallError('bad_response');
  return content;
}

function unconfigured(engine: string, target: ModelConnector['target']): ModelConnector {
  return {
    engine,
    target,
    ask() {
      return Promise.reject(new ModelCallError('not_configured'));
    },
  };
}

/** Ollama on this device. `POST /api/chat`, no key, no release. */
export function createOllamaModel(options: OllamaModelOptions): ModelConnector {
  const url = endpoint(options.baseUrl ?? 'http://127.0.0.1:11434', 'api/chat');
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    engine: OLLAMA_ENGINE,
    target: 'local_model',
    async ask(pkg, question) {
      const content = prompt(
        question,
        pkg.items.map((item) => item.card),
      );
      const json = await postJson(
        options.fetch,
        url,
        { model, stream: false, messages: [{ role: 'user', content }] },
        timeoutMs,
      );
      return comment(
        chatContent(json, (record) =>
          isRecord(record['message']) ? record['message']['content'] : undefined,
        ),
      );
    },
  };
}

/**
 * A cloud chat model (LiteLLM or anything that speaks `/v1/chat/completions`).
 * Sends nothing without a release of exactly the package's cards.
 */
export function createCloudChatModel(options: CloudChatModelOptions): ModelConnector {
  if (!options.baseUrl) return unconfigured(CLOUD_CHAT_ENGINE, 'cloud_model');
  const url = endpoint(options.baseUrl, 'v1/chat/completions');
  const model = options.model ?? DEFAULT_CLOUD_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    engine: CLOUD_CHAT_ENGINE,
    target: 'cloud_model',
    async ask(pkg, question, release) {
      const content = prompt(question, releasedCards(pkg, release));
      const json = await postJson(
        options.fetch,
        url,
        { model, messages: [{ role: 'user', content }] },
        timeoutMs,
        options.apiKey,
      );
      return comment(
        chatContent(json, (record) => {
          const choices = record['choices'];
          if (!Array.isArray(choices) || !isRecord(choices[0])) return undefined;
          const message = choices[0]['message'];
          return isRecord(message) ? message['content'] : undefined;
        }),
      );
    },
  };
}

/** External decision service. `POST /v1/decide` with `{ question, state }` and `{ answer }`. */
export function createDecisionStub(options: DecisionStubOptions): ModelConnector {
  if (!options.baseUrl) return unconfigured(DECISION_STUB_ENGINE, 'cloud_model');
  const url = endpoint(options.baseUrl, 'v1/decide');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    engine: DECISION_STUB_ENGINE,
    target: 'cloud_model',
    async ask(pkg, question, release) {
      const state = cardLines(releasedCards(pkg, release));
      const asked = question.trim();
      if (`${asked}\n\n${state}`.length > MAX_PROMPT_CHARS)
        throw new ModelCallError('request_too_large');
      const json = await postJson(
        options.fetch,
        url,
        { question: asked, state },
        timeoutMs,
        options.apiKey,
      );
      if (!isRecord(json) || typeof json['answer'] !== 'string')
        throw new ModelCallError('bad_response');
      return comment(json['answer']);
    },
  };
}
