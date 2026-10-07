// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Escalation to level 2 (ADR-0035): from any player prediction the user can open a board
// analysis. The draft is the body of the human-only `lage_create` operation; nothing of the
// prediction (move, confidence) is copied into it as fact.

import type {
  Level1Prediction,
  Level1PredictionRequest,
  LageCreateRequest,
} from '@worldbuilder/core';

export interface Level2Draft {
  /** Body for the human-only `lage_create`. */
  readonly create: LageCreateRequest;
  /** The Lage the prediction was made on: the service records the link back (for example as a
   * `based_on` edge of the new Lage card) and the board offers it. */
  readonly sourceLageId: string;
  readonly playerCardId: string;
  /** The engine that made the estimate, for attribution next to the link. */
  readonly engine: string;
}

export interface Level2DraftOptions {
  /** The human seat of the new board. Default "Analyst". */
  readonly seatName?: string;
  readonly now?: () => Date;
  /** Worlds of the new Lage card. */
  readonly worlds?: readonly string[];
  /** Horizontal distance between placed cards. */
  readonly grid?: number;
}

/**
 * A level-2 Lage draft for one player's prediction: the question asks for that player's next
 * move, the options are the move options, the cards the engine used are placed (the player card
 * first, then the others in a row below) and the user is the only seat. Throws if the player is
 * not in the prediction or a card used is not in the request.
 */
export function buildLevel2Draft(
  prediction: Level1Prediction,
  request: Level1PredictionRequest,
  playerCardId: string,
  options: Level2DraftOptions = {},
): Level2Draft {
  const player = prediction.players.find((p) => p.playerCardId === playerCardId);
  if (!player) throw new RangeError(`player ${playerCardId} is not in the prediction`);
  const byId = new Map(request.cards.map((c) => [c.id, c] as const));
  const missing = player.cardIds.find((id) => !byId.has(id));
  if (missing) throw new RangeError(`card ${missing} is not a card of the request`);
  if (prediction.lageId !== request.lageId)
    throw new RangeError('the prediction belongs to another Lage than the request');

  const name = byId.get(playerCardId)?.title ?? playerCardId;
  const grid = options.grid ?? 220;
  const others = player.cardIds.filter((id) => id !== playerCardId);
  const placed = [
    { id: playerCardId, x: Math.max(0, ((others.length - 1) * grid) / 2), y: 80 },
    ...others.map((id, i) => ({ id, x: i * grid, y: 320 })),
  ];
  const now = options.now ?? (() => new Date());
  return {
    create: {
      title: `Next move of ${name}`,
      ...(options.worlds ? { worlds: [...options.worlds] } : {}),
      lage: {
        question: `What is the most likely next move of ${name}? (From: ${request.question})`,
        options: [...player.moveOptions],
        cards: placed,
        seats: [{ name: options.seatName ?? 'Analyst', kind: 'human' }],
        edges: [],
        version: 1,
        updatedAt: now().toISOString(),
      },
    },
    sourceLageId: prediction.lageId,
    playerCardId,
    engine: prediction.engine,
  };
}
