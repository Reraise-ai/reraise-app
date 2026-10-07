// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Board display contract for level-1 estimates (ADR-0015, ADR-0035): an attributed estimate next
// to a player, never a verdict. The board shows exactly this text and offers the cards used one
// click away.

import type { Level1PlayerPrediction, Level1Prediction } from '@worldbuilder/core';

export interface EstimateView {
  /** Engine id, as in `Level1Prediction.engine`. */
  readonly engine: string;
  readonly predictedMove: string;
  /** In [0, 1]. */
  readonly confidence: number;
}

/** Control characters and line breaks would break the one-line display; collapse them. */
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/**
 * "<engine> estimates 0.82 for <move>": the confidence with two decimals, always with the
 * engine's name, never worded as an answer or a verdict.
 */
export function formatEstimate(view: EstimateView): string {
  const { engine, predictedMove, confidence } = view;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    throw new RangeError(`confidence ${confidence} is not in [0, 1]`);
  const e = clean(engine);
  const m = clean(predictedMove);
  if (!e || !m) throw new RangeError('an estimate needs an engine and a move');
  return `${e} estimates ${confidence.toFixed(2)} for ${m}`;
}

/** The display line of every player of a prediction, by player card id, in prediction order. */
export function formatEstimates(
  prediction: Pick<Level1Prediction, 'engine' | 'players'>,
): { playerCardId: string; text: string }[] {
  return prediction.players.map((p: Level1PlayerPrediction) => ({
    playerCardId: p.playerCardId,
    text: formatEstimate({ engine: prediction.engine, ...p }),
  }));
}
