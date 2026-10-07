// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// What-if re-run (ADR-0035): when the user places, removes or edits an assumption card, the
// request hash changes; a prediction is shown only while its hash equals the hash of the current
// request. A local engine re-runs by itself; a cloud engine never does (every change is a new
// transfer that needs a new preview and confirmation).

import type {
  DisclosureRelease,
  Level1Engine,
  Level1Prediction,
  Level1PredictionRequest,
} from '@worldbuilder/core';
import { hashJcs } from '@worldbuilder/core';

/**
 * Hash of the request without its trigger: the board's content (question, players, cards). The
 * trigger says why the engine ran, not what it was asked, so it must not make a prediction stale:
 * undoing an assumption brings the board, and the prediction, back.
 */
export function stalenessKey(request: Level1PredictionRequest): string {
  const rest: Partial<Level1PredictionRequest> = { ...request };
  delete rest.trigger;
  return hashJcs(rest);
}

/**
 * True if the prediction does not describe the current board (or there is none). The request is
 * compared under the prediction's own trigger, so only a change of content makes it stale;
 * `stalenessKey` is the equivalent trigger-free key.
 */
export function isStale(
  prediction: Pick<Level1Prediction, 'requestHash' | 'trigger'> | undefined,
  request: Level1PredictionRequest,
): boolean {
  return (
    !prediction || prediction.requestHash !== hashJcs({ ...request, trigger: prediction.trigger })
  );
}

/** Everything wrong with an engine's answer to a request, as messages; empty when it fits. */
export function answerProblems(
  engineId: string,
  request: Level1PredictionRequest,
  prediction: Level1Prediction,
): string[] {
  const problems: string[] = [];
  if (prediction.engine !== engineId) problems.push(`engine is ${prediction.engine}`);
  if (prediction.lageId !== request.lageId) problems.push('lageId differs from the request');
  if (prediction.requestHash !== hashJcs(request))
    problems.push('requestHash differs from the request');
  if (prediction.players.length !== request.players.length) problems.push('players differ');
  request.players.forEach((asked, i) => {
    const got = prediction.players[i];
    if (!got || got.playerCardId !== asked.playerCardId) problems.push(`player ${i} differs`);
    else if (!asked.moveOptions.includes(got.predictedMove))
      problems.push(`player ${asked.playerCardId}: the move is not one of the options`);
  });
  return problems;
}

/**
 * Discard a late answer: the prediction if it still describes the current request, otherwise
 * `undefined` (latest wins).
 */
export function currentOnly(
  prediction: Level1Prediction,
  request: Level1PredictionRequest,
): Level1Prediction | undefined {
  return isStale(prediction, request) ? undefined : prediction;
}

/** The request with the `assumption_changed` trigger naming the changed assumption cards. */
export function assumptionChangedRequest(
  request: Level1PredictionRequest,
  assumptionCardIds: readonly string[],
): Level1PredictionRequest {
  const ids = [...new Set(assumptionCardIds)];
  if (ids.length === 0) throw new RangeError('name at least one changed assumption card');
  return { ...request, trigger: { kind: 'assumption_changed', cardIds: ids } };
}

export interface MoveChange {
  readonly playerCardId: string;
  readonly from: string;
  readonly to: string;
  readonly confidenceFrom: number;
  readonly confidenceTo: number;
}

/** Players whose predicted move differs between two predictions (for highlighting on the board). */
export function changedMoves(
  before: Level1Prediction | undefined,
  after: Level1Prediction,
): MoveChange[] {
  if (!before) return [];
  const prior = new Map(before.players.map((p) => [p.playerCardId, p] as const));
  return after.players.flatMap((p) => {
    const was = prior.get(p.playerCardId);
    return was && was.predictedMove !== p.predictedMove
      ? [
          {
            playerCardId: p.playerCardId,
            from: was.predictedMove,
            to: p.predictedMove,
            confidenceFrom: was.confidence,
            confidenceTo: p.confidence,
          },
        ]
      : [];
  });
}

export interface WhatIfResult {
  /** The prediction to show: the new one, or the previous one (then `stale`), if any. */
  readonly prediction: Level1Prediction | undefined;
  /** `prediction` does not describe the current request: show it as stale. */
  readonly stale: boolean;
  /** The engine ran in this call. */
  readonly reran: boolean;
  /** A cloud engine needs a new preview and confirmation before it can re-run. */
  readonly needsConfirmation: boolean;
  /** Players whose predicted move changed against `previous`. */
  readonly changes: readonly MoveChange[];
}

/**
 * Re-run after an assumption change. `request.trigger` must be `assumption_changed`.
 *
 * - The previous prediction already matches the request: nothing runs, nothing is stale.
 * - A `local_model` engine runs and the new prediction replaces the previous one.
 * - A `cloud_model` engine runs only if the caller passes the release of a freshly confirmed
 *   transfer; otherwise nothing is sent, the previous prediction is returned as stale and
 *   `needsConfirmation` is set. There is no automatic cloud transfer.
 */
export async function rerunOnAssumptionChange(
  engine: Level1Engine,
  previous: Level1Prediction | undefined,
  request: Level1PredictionRequest,
  release?: DisclosureRelease,
): Promise<WhatIfResult> {
  if (request.trigger.kind !== 'assumption_changed')
    throw new RangeError('rerunOnAssumptionChange needs an assumption_changed request');
  if (previous && !isStale(previous, request))
    return {
      prediction: previous,
      stale: false,
      reran: false,
      needsConfirmation: false,
      changes: [],
    };
  if (engine.target === 'cloud_model' && !release)
    return {
      prediction: previous,
      stale: previous !== undefined,
      reran: false,
      needsConfirmation: true,
      changes: [],
    };
  const prediction = await engine.predict(request, release);
  const problems = answerProblems(engine.engine, request, prediction);
  if (problems.length > 0) throw new Error(`engine answer rejected: ${problems.join('; ')}`);
  return {
    prediction,
    stale: false,
    reran: true,
    needsConfirmation: false,
    changes: changedMoves(previous, prediction),
  };
}
