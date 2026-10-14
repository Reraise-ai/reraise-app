// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The shared services behind every operation (Board API now, MCP tools in the next slice;
// ADR-0029: one adapter, one gate, one proposal list per process).

import type { Card, Lage, LocalStateStore, Stance, StorageAdapter } from '@worldbuilder/core';
import type { Disclosures } from './disclosure.js';
import type { GateService } from './gate.js';
import type { Level1Service } from './level1.js';
import type { LiveBus } from './live.js';
import type { ScenarioLayers } from './scenario.js';
import type { ReceiptStore } from './receipts.js';
import type { Mutex } from './util.js';

export interface Services {
  readonly storage: StorageAdapter;
  readonly localState: LocalStateStore;
  readonly gate: GateService;
  readonly disclosures: Disclosures;
  /** Device receipt key and receipt log (ADR-0039, ADR-0040). */
  readonly receipts: ReceiptStore;
  /** Level 1: engines, the latest prediction per Lage, escalation (ADR-0045). */
  readonly level1: Level1Service;
  /** Live what-if layer per Lage, in memory only (ADR-0050). */
  readonly scenario: ScenarioLayers;
  /** Open boards hear a move or a proposal without a card body (ADR-0032). */
  readonly live: LiveBus;
  /** Serialises every write that reads then changes the store (single writer, ADR-0006). */
  readonly writes: Mutex;
  readonly now: () => Date;
}

/** A card of type lage with its board state. */
export type LageCard = Card & { lage: Lage };

export const isLageCard = (card: Card | undefined): card is LageCard =>
  card !== undefined && card.type === 'lage' && card.lage !== undefined;

/**
 * The user's own stance on a card: the device-only record, else the stance the store already
 * holds in legacy fields (read only, ADR-0008). Only ever used for the local screen.
 */
export async function stanceFor(s: Services, cardId: string): Promise<Stance | undefined> {
  return (await s.localState.getStance(cardId)) ?? (await s.storage.readLegacyStance?.(cardId));
}

/** All pages of a paged storage query, up to `max` items. */
export async function collect<T>(
  fetch: (cursor: string | undefined) => Promise<{ items: readonly T[]; nextCursor?: string }>,
  max: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined && out.length < max);
  return out.slice(0, max);
}
