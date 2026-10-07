// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Changes to the board state of a Lage, written as a new version through the StorageAdapter
// (ADR-0006: the adapter archives the previous version; the service sends a patch).

import type { Lage } from '@worldbuilder/core';
import { HttpError } from './problem.js';
import { isLageCard, type LageCard, type Services } from './services.js';

export async function readLage(s: Services, lageId: string): Promise<LageCard | undefined> {
  const card = await s.storage.read(lageId);
  return isLageCard(card) ? card : undefined;
}

/**
 * Write the Lage returned by `change` as version + 1. The caller holds the write lock. A
 * change that cannot be applied throws `HttpError(409)` from inside `change`.
 */
export async function writeLageVersion(
  s: Services,
  lageId: string,
  change: (lage: Lage) => Lage,
): Promise<void> {
  const card = await readLage(s, lageId);
  if (!card) throw new HttpError(409, 'the Lage does not exist');
  const next: Lage = {
    ...change(card.lage),
    version: card.lage.version + 1,
    updatedAt: s.now().toISOString(),
  };
  await s.storage.patch(lageId, { lage: next }, { lageVersion: card.lage.version });
}

/** The Lage with the card placed at x, y (moved if it is already there). */
export function withPlacement(lage: Lage, cardId: string, x: number, y: number): Lage {
  const exists = lage.cards.some((c) => c.id === cardId);
  return {
    ...lage,
    cards: exists
      ? lage.cards.map((c) => (c.id === cardId ? { id: cardId, x, y } : c))
      : [...lage.cards, { id: cardId, x, y }],
  };
}
