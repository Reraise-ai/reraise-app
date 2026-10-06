// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// A trivial Level1Engine for testing the kit and as a starting point for engine authors. It is
// not the local default engine (a later slice, ADR-0035): it always predicts the first move
// option with confidence 0.5, based on the player card alone.

import type {
  DisclosureRelease,
  Level1Engine,
  Level1Prediction,
  Level1PredictionRequest,
} from '@worldbuilder/core';
import { hashJcs } from '@worldbuilder/core';

export interface FixedLevel1EngineOptions {
  readonly engine?: string;
  readonly target?: 'local_model' | 'cloud_model';
  readonly now?: () => Date;
}

/**
 * True if the release carries exactly the request's cards, object for object (id and content
 * hash): what a cloud engine must check before anything is sent (ADR-0031, ADR-0035).
 */
export function releaseCoversRequest(
  request: Level1PredictionRequest,
  release: DisclosureRelease | undefined,
): boolean {
  if (!release || release.objects.length !== request.cards.length) return false;
  return request.cards.every(
    (c, i) => release.objects[i]?.id === c.id && release.objects[i]?.contentHash === c.contentHash,
  );
}

export function createFixedLevel1Engine(options: FixedLevel1EngineOptions = {}): Level1Engine {
  const engine = options.engine ?? 'fixed-first-option';
  const target = options.target ?? 'local_model';
  const now = options.now ?? (() => new Date());
  return {
    engine,
    target,
    deterministic: true,
    predict(request, release) {
      if (target === 'cloud_model' && !releaseCoversRequest(request, release)) {
        return Promise.reject(
          new Error('cloud engine: no confirmed release of exactly these cards'),
        );
      }
      const prediction: Level1Prediction = {
        engine,
        lageId: request.lageId,
        trigger: structuredClone(request.trigger),
        requestHash: hashJcs(request),
        players: request.players.map((p) => ({
          playerCardId: p.playerCardId,
          moveOptions: [...p.moveOptions],
          predictedMove: p.moveOptions[0]!,
          confidence: 0.5,
          cardIds: [p.playerCardId],
        })),
        predictedAt: now().toISOString(),
      };
      return Promise.resolve(prediction);
    },
  };
}
