// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Conformance kit for Level1Engine implementations (ADR-0035). Every engine (the local default
// engine, a local model, an external decision service such as Jev) runs this suite:
//
//   describeLevel1EngineConformance('my engine', async () => ({ engine, request }));

import type {
  Card,
  DisclosurePreviewEnvelope,
  DisclosureRelease,
  Level1Engine,
  Level1Prediction,
  Level1PredictionRequest,
} from '@worldbuilder/core';
import { computeContentHash, computePayloadHash, hashJcs } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { schemaValidator } from './validate.js';

const PREDICTION = 'https://worldbuilder.invalid/schemas/v0/level1-prediction.schema.json';

export interface Level1EngineHarness {
  readonly engine: Level1Engine;
  /**
   * A valid request the engine can answer: at least one player with move options, and the
   * gate-cleared cards on the board (the player cards among them) plus any rule cards.
   */
  readonly request: Level1PredictionRequest;
  /**
   * Builds the release of a confirmed transfer of `cards` for `request`, as the gate would return
   * it for the envelope this engine sends (see `releaseOfEnvelope`). A cloud engine that binds
   * the confirmation to its envelope must supply it; the default is `releaseOf(cards)`.
   */
  readonly releaseFor?: (
    request: Level1PredictionRequest,
    cards: readonly Card[],
  ) => DisclosureRelease;
}

export type Level1EngineFactory = () => Promise<Level1EngineHarness> | Level1EngineHarness;

/**
 * Everything wrong with a prediction for a request, as messages; empty when conformant. Used
 * by the kit and usable on its own, for example to check a remote engine's recorded answers.
 */
export function level1PredictionProblems(
  engine: Pick<Level1Engine, 'engine'>,
  request: Level1PredictionRequest,
  prediction: Level1Prediction,
): string[] {
  const validate = schemaValidator(PREDICTION);
  if (!validate(prediction)) {
    return (validate.errors ?? []).map((e) => `schema: ${e.instancePath || '/'} ${e.message}`);
  }
  const problems: string[] = [];
  const onBoard = new Set(request.cards.map((c) => c.id));
  if (prediction.engine !== engine.engine)
    problems.push(`engine is "${prediction.engine}", expected "${engine.engine}"`);
  if (prediction.lageId !== request.lageId) problems.push('lageId differs from the request');
  if (hashJcs(prediction.trigger) !== hashJcs(request.trigger))
    problems.push('trigger differs from the request');
  if (prediction.requestHash !== hashJcs(request))
    problems.push('requestHash is not the RFC 8785 hash of the request');
  const asked = request.players.map((p) => p.playerCardId);
  const answered = prediction.players.map((p) => p.playerCardId);
  if (hashJcs(asked) !== hashJcs(answered))
    problems.push(`players ${answered.join(',')} differ from the request ${asked.join(',')}`);
  prediction.players.forEach((p, i) => {
    const wanted = request.players[i];
    if (wanted && hashJcs(p.moveOptions) !== hashJcs(wanted.moveOptions))
      problems.push(`player ${p.playerCardId}: move options differ from the request`);
    if (!p.moveOptions.includes(p.predictedMove))
      problems.push(`player ${p.playerCardId}: "${p.predictedMove}" is not a move option`);
    if (!p.cardIds.includes(p.playerCardId))
      problems.push(`player ${p.playerCardId}: the player card is not among the cards used`);
    for (const id of p.cardIds)
      if (!onBoard.has(id))
        problems.push(`player ${p.playerCardId}: card ${id} is not on the board`);
  });
  return problems;
}

/** The release of a confirmed transfer of `envelope`, as the gate would return it. */
export function releaseOfEnvelope(envelope: DisclosurePreviewEnvelope): DisclosureRelease {
  const objects = structuredClone([...envelope.objects]);
  return {
    confirmation: {
      transferId: '01M1HA4MC0T8585XX5H0E6NVRP',
      payloadHash: computePayloadHash(envelope),
      cardIds: objects.map((c) => c.id),
      confirmedAt: '2026-10-06T10:00:00Z',
    },
    objects,
  };
}

/** The release of a confirmed transfer of exactly `cards`, as the gate would return it. */
export function releaseOf(cards: readonly Card[]): DisclosureRelease {
  return releaseOfEnvelope({
    target: 'cloud_model',
    connectorId: 'conformance',
    request: {},
    objects: structuredClone([...cards]),
  });
}

const failed = async (p: Promise<unknown>) =>
  p.then(
    () => false,
    () => true,
  );

/** The prediction without the time it was made, for determinism checks. */
const timeless = ({ predictedAt: _at, ...rest }: Level1Prediction) => rest;

export function describeLevel1EngineConformance(name: string, factory: Level1EngineFactory): void {
  describe(`Level1Engine conformance: ${name}`, () => {
    const releaseFor = (
      h: Level1EngineHarness,
      request: Level1PredictionRequest,
      cards: readonly Card[],
    ) => (h.releaseFor ? h.releaseFor(request, cards) : releaseOf(cards));
    const run = async (h: Level1EngineHarness, request = h.request) =>
      h.engine.predict(
        request,
        h.engine.target === 'cloud_model' ? releaseFor(h, request, request.cards) : undefined,
      );

    it('declares an engine id and a model target class', async () => {
      const { engine } = await factory();
      expect(engine.engine).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
      expect(['local_model', 'cloud_model']).toContain(engine.target);
      expect(typeof engine.deterministic).toBe('boolean');
    });

    it('predicts a move option per player, with confidence in [0, 1], from on-board cards only', async () => {
      const h = await factory();
      const prediction = await run(h);
      expect(level1PredictionProblems(h.engine, h.request, prediction)).toEqual([]);
    });

    it('never names a card that is not in the request, also when it gets fewer cards', async () => {
      const h = await factory();
      const players = new Set(h.request.players.map((p) => p.playerCardId));
      const fewer = { ...h.request, cards: h.request.cards.filter((c) => players.has(c.id)) };
      const prediction = await run(h, fewer);
      expect(level1PredictionProblems(h.engine, fewer, prediction)).toEqual([]);
    });

    it('does not change the request', async () => {
      const h = await factory();
      const before = hashJcs(h.request);
      await run(h);
      expect(hashJcs(h.request)).toBe(before);
    });

    it('is deterministic when it says so', async () => {
      const h = await factory();
      if (!h.engine.deterministic) return;
      const [a, b] = [await run(h), await run(h)];
      expect(timeless(b)).toEqual(timeless(a));
    });

    it('as a cloud engine, predicts only on exactly the confirmed, gate-cleared cards', async () => {
      const h = await factory();
      if (h.engine.target !== 'cloud_model') return;
      const { request, engine } = h;
      const rel = (cards: readonly Card[]) => releaseFor(h, request, cards);
      expect(await failed(engine.predict(request)), 'without a release').toBe(true);
      const [first, ...rest] = request.cards;
      if (rest.length > 0) {
        expect(
          await failed(engine.predict(request, rel(rest))),
          'a request card outside the release',
        ).toBe(true);
      }
      const edited = { ...first!, title: `${first!.title} (edited)` };
      const editedRelease = rel([{ ...edited, contentHash: computeContentHash(edited) }, ...rest]);
      expect(
        await failed(engine.predict(request, editedRelease)),
        'a card edited after confirmation',
      ).toBe(true);
      const prediction = await engine.predict(request, rel(request.cards));
      expect(level1PredictionProblems(engine, request, prediction)).toEqual([]);
    });
  });
}
