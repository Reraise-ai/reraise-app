// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// A generic HTTP adapter for cloud "System One" engines: services that take an instruction, an
// unstructured state and an output schema, and answer with a typed result and a calibrated
// confidence (ADR-0015, ADR-0035). Jev is one example (`createJevAdapter`); other providers
// plug in as a preset. The wire format is NOT confirmed for any real provider (owner decision
// OD-4): the presets below are templates and must be checked against the provider's contract
// before use.
//
// Rules the adapter enforces:
// - It predicts only with the `DisclosureRelease` of one confirmed transfer (ADR-0031). Before
//   anything is sent it recomputes the envelope (`level1EnvelopeFor`: connector, question, flattened
//   options, output schema, released cards) and requires its hash to equal the confirmed
//   `payloadHash`; the question, options and output schema it sends are those of that envelope and
//   the state is built from the release objects alone, never from raw cards. Without a matching
//   release nothing is sent. Whether the release is genuine and unspent is the service's job
//   (`DisclosureGate.redeem`), not something an engine can verify.
// - It sends content fields only: no store identity (uri, externalId), no worlds, tags, class,
//   visibility, release, training flag or personality type.
// - It follows no redirects, never logs or echoes the credential or the answer body in errors,
//   and treats every answer as untrusted: the move must be one of the options, the confidence in
//   [0, 1], every card id one of the released cards.

import type {
  Card,
  DisclosurePreviewEnvelope,
  DisclosureRelease,
  Level1Engine,
  Level1Prediction,
  Level1PredictionRequest,
  PlayerEntry,
} from '@worldbuilder/core';
import { computePayloadHash, hashJcs } from '@worldbuilder/core';
import { level1EnvelopeFor } from './envelope.js';
import { releaseProblem } from './release.js';

export type Level1EngineErrorCode =
  'release_required' | 'request_too_large' | 'http_error' | 'bad_response';

/** An engine failure. The message never contains content, the credential or the answer body. */
export class Level1EngineError extends Error {
  constructor(
    readonly code: Level1EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'Level1EngineError';
  }
}

export interface DecidePlayer {
  readonly playerCardId: string;
  readonly title: string;
  readonly moveOptions: readonly string[];
}

/** What a preset turns into a wire body: everything comes from the release. */
export interface DecideInput {
  readonly question: string;
  /** The flattened options of the confirmed envelope (`<playerCardId>: <move>`). */
  readonly options: readonly string[];
  /** The output schema of the confirmed envelope. */
  readonly outputSchema: Record<string, unknown>;
  readonly players: readonly DecidePlayer[];
  /** The released cards as unstructured text. */
  readonly state: string;
  /** Ids of the released cards. */
  readonly cardIds: readonly string[];
}

/** One player's answer as read from the wire, before validation. */
export interface RawAnswer {
  readonly predictedMove?: unknown;
  readonly confidence?: unknown;
  readonly cardIds?: unknown;
}

/** How a provider's wire format maps to and from the generic decision. */
export interface SystemOneProviderPreset {
  readonly id: string;
  /** Default engine id when the caller gives none. */
  readonly defaultEngine: string;
  /** Path below the base URL. */
  readonly path: string;
  buildBody(input: DecideInput): unknown;
  /** The answer for each player id as found in the response, if present. */
  readAnswers(response: unknown, input: DecideInput): ReadonlyMap<string, RawAnswer>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const INSTRUCTION =
  'For each player named in the output schema, predict the single most likely next move ' +
  'out of the allowed moves, using only the state below. Give your own calibrated ' +
  'confidence in [0, 1] and the ids of the cards you used.';

/**
 * The generic `POST /v1/decide` template: `{ instruction, question, options, state, output_schema }` in,
 * `{ output: { <playerCardId>: { predictedMove, confidence, cardIds? } }, confidence? }` out. A
 * top-level `confidence` is used for players whose entry has none.
 */
export const GENERIC_SYSTEM_ONE_PRESET: SystemOneProviderPreset = {
  id: 'generic-decide-v1',
  defaultEngine: 'system-one',
  path: '/v1/decide',
  buildBody: (input) => ({
    instruction: INSTRUCTION,
    question: input.question,
    options: input.options,
    state: input.state,
    output_schema: input.outputSchema,
  }),
  readAnswers(response) {
    const answers = new Map<string, RawAnswer>();
    if (!isRecord(response) || !isRecord(response.output)) return answers;
    for (const [id, value] of Object.entries(response.output)) {
      if (!isRecord(value)) continue;
      answers.set(id, {
        predictedMove: value.predictedMove,
        confidence: value.confidence ?? response.confidence,
        cardIds: value.cardIds,
      });
    }
    return answers;
  },
};

/**
 * Jev as one example of a System One service, as far as ADR-0015 describes it: `POST /v1/decide`
 * with a caller-defined output schema and an unstructured state, answering with a typed result and
 * a calibrated confidence. The real wire format is unconfirmed (owner decision OD-4); until the
 * owner supplies it this preset is the generic template under another engine id.
 */
export const JEV_PRESET: SystemOneProviderPreset = {
  ...GENERIC_SYSTEM_ONE_PRESET,
  id: 'jev',
  defaultEngine: 'jev',
};

export const SYSTEM_ONE_PRESETS: Readonly<Record<string, SystemOneProviderPreset>> = {
  [GENERIC_SYSTEM_ONE_PRESET.id]: GENERIC_SYSTEM_ONE_PRESET,
  [JEV_PRESET.id]: JEV_PRESET,
};

export interface SystemOneHttpAdapterOptions {
  /** Base URL of the service: https, or http on a loopback address for local testing. */
  readonly baseUrl: string;
  /** Injected so that tests never touch the network. Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Bearer credential, or a function that returns it per call. Never logged or echoed. */
  readonly apiKey?: string | (() => string | Promise<string>);
  readonly engine?: string;
  readonly preset?: SystemOneProviderPreset;
  readonly timeoutMs?: number;
  /** Upper bound for the rendered state, in characters. */
  readonly maxStateChars?: number;
  readonly now?: () => Date;
}

const MAX_BODY_CHARS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const ENGINE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function endpoint(baseUrl: string, path: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new TypeError('baseUrl is not a URL');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))
    throw new TypeError('baseUrl must be https (http only on a loopback address)');
  if (base.username || base.password) throw new TypeError('baseUrl must not carry credentials');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(path.replace(/^\//, ''), base);
}

const entries = (label: string, list: readonly PlayerEntry[] | undefined) =>
  list && list.length > 0
    ? [`${label}: ${list.map((e) => `${e.text} (source: ${e.source})`).join('; ')}`]
    : [];

/** Links to other released cards only: an id outside the transfer is not content of it. */
function links(card: Card, releasedIds: ReadonlySet<string>): string[] {
  const kept = (card.edges ?? []).filter((e) => releasedIds.has(e.target));
  return kept.length > 0
    ? [`Links: ${kept.map((e) => `${e.kind} -> ${e.target}`).join('; ')}`]
    : [];
}

/** One released card as text: content fields only. */
export function renderCard(card: Card, releasedIds: ReadonlySet<string>): string {
  const lines = [
    `[card ${card.id}] type: ${card.type}${card.layer ? `, layer: ${card.layer}` : ''}`,
    `Title: ${card.title}`,
    ...(card.date ? [`Date: ${card.date}`] : []),
    ...(card.source ? [`Source: ${card.source}`] : []),
    ...(card.body ? [`Body: ${card.body.slice(0, MAX_BODY_CHARS)}`] : []),
    ...entries('Interests', card.interests),
    ...entries('Capabilities', card.capabilities),
    ...entries('Dependencies', card.dependencies),
    ...entries('Past moves', card.moves),
    ...entries('Red lines', card.redLines),
    ...entries('Assumed goals', card.assumedGoals),
    ...(card.rule ? [`User rule: ${JSON.stringify(card.rule)}`] : []),
    ...links(card, releasedIds),
  ];
  return lines.join('\n');
}

/**
 * The decision input, built from a release (never from raw cards) and the confirmed envelope: the
 * question, options and output schema are the envelope's, the state is the released cards.
 */
export function decideInputFrom(
  request: Level1PredictionRequest,
  release: DisclosureRelease,
  envelope: DisclosurePreviewEnvelope,
  maxStateChars = 100_000,
): DecideInput {
  const ids = new Set(release.objects.map((c) => c.id));
  const state = release.objects.map((c) => renderCard(c, ids)).join('\n\n');
  if (state.length > maxStateChars)
    throw new Level1EngineError('request_too_large', 'the released cards exceed the state limit');
  const byId = new Map(release.objects.map((c) => [c.id, c] as const));
  return {
    question: envelope.request.question ?? request.question,
    options: envelope.request.options ?? [],
    outputSchema: envelope.request.outputSchema ?? {},
    players: request.players.map((p) => ({
      playerCardId: p.playerCardId,
      title: byId.get(p.playerCardId)?.title ?? p.playerCardId,
      moveOptions: p.moveOptions,
    })),
    state,
    cardIds: release.objects.map((c) => c.id),
  };
}

/** Read a response body as text, never holding more than `MAX_RESPONSE_BYTES`. */
async function readCapped(response: Response): Promise<string> {
  const tooLarge = () => new Error('too large');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return '';
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
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Validate one answer against what was asked; anything unexpected is a bad response. */
function accept(
  raw: RawAnswer | undefined,
  player: DecidePlayer,
  released: ReadonlySet<string>,
): Level1Prediction['players'][number] {
  const bad = (why: string) =>
    new Level1EngineError('bad_response', `answer for player ${player.playerCardId}: ${why}`);
  if (!raw) throw bad('missing');
  const move = raw.predictedMove;
  if (typeof move !== 'string' || !player.moveOptions.includes(move))
    throw bad('the move is not one of the options');
  const confidence = raw.confidence;
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  )
    throw bad('confidence is not a number in [0, 1]');
  let ids: string[] = [];
  if (raw.cardIds !== undefined) {
    if (!Array.isArray(raw.cardIds) || raw.cardIds.some((x) => typeof x !== 'string'))
      throw bad('cardIds is not a list of ids');
    ids = raw.cardIds as string[];
    if (ids.some((id) => !released.has(id)))
      throw bad('a card id is not one of the released cards');
  }
  return {
    playerCardId: player.playerCardId,
    moveOptions: [...player.moveOptions],
    predictedMove: move,
    confidence,
    cardIds: [...new Set([player.playerCardId, ...ids])],
  };
}

/**
 * A Level1Engine over a System One HTTP service (target `cloud_model`, not deterministic). One
 * call sends one transfer: the release's cards, the question and an output schema with the
 * move options as enums; nothing is cached or retried.
 */
export function createSystemOneHttpAdapter(options: SystemOneHttpAdapterOptions): Level1Engine {
  const preset = options.preset ?? GENERIC_SYSTEM_ONE_PRESET;
  const engine = options.engine ?? preset.defaultEngine;
  if (!ENGINE_ID.test(engine)) throw new TypeError('engine id is not a valid engine id');
  const url = endpoint(options.baseUrl, preset.path);
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const now = options.now ?? (() => new Date());

  return {
    engine,
    target: 'cloud_model',
    deterministic: false,
    async predict(request, release) {
      const problem = releaseProblem(request, release);
      if (problem || !release)
        throw new Level1EngineError(
          'release_required',
          `cloud engine ${engine}: ${problem ?? 'no confirmed release'}`,
        );
      const envelope = level1EnvelopeFor(engine, request, release.objects);
      if (computePayloadHash(envelope) !== release.confirmation.payloadHash)
        throw new Level1EngineError(
          'release_required',
          `cloud engine ${engine}: the confirmation is for another connector, question, options, output schema or card set`,
        );
      const input = decideInputFrom(request, release, envelope, options.maxStateChars);
      const key = typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey;
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(preset.buildBody(input)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // The cause may carry the URL or headers; report only that the call failed.
        throw new Level1EngineError('http_error', `cloud engine ${engine}: the request failed`);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Level1EngineError(
          'http_error',
          `cloud engine ${engine}: the service answered HTTP ${response.status}`,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(await readCapped(response));
      } catch {
        throw new Level1EngineError(
          'bad_response',
          `cloud engine ${engine}: the answer is not JSON`,
        );
      }
      const answers = preset.readAnswers(json, input);
      const released = new Set(input.cardIds);
      return {
        engine,
        lageId: request.lageId,
        trigger: structuredClone(request.trigger),
        requestHash: hashJcs(request),
        players: input.players.map((p) => accept(answers.get(p.playerCardId), p, released)),
        predictedAt: now().toISOString(),
      };
    },
  };
}

export type JevAdapterOptions = Omit<SystemOneHttpAdapterOptions, 'preset'>;

/** Jev as one System One engine (preset `JEV_PRESET`; the wire format is unconfirmed, OD-4). */
export function createJevAdapter(options: JevAdapterOptions): Level1Engine {
  return createSystemOneHttpAdapter({ ...options, preset: JEV_PRESET });
}
