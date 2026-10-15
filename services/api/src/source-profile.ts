// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// When a decision's outcome leaves `open`, store a hit count for each source of a card in
// cardsUsed (ADR-0018). The profile lives on the device. A later edit of the outcome does not
// count again.

import type { Card, LocalStateStore, StorageAdapter } from '@worldbuilder/core';
import { deriveSourceProfiles, isKnownOutcome, profileSourceOf } from '@worldbuilder/core';
import { collect } from './services.js';

/** Writes the derived profiles of the sources this decision cites, once, on the way to a known outcome. */
export async function recordSourceProfiles(
  storage: StorageAdapter,
  localState: LocalStateStore,
  before: Card | undefined,
  after: Card,
  computedAt: string,
): Promise<void> {
  if (isKnownOutcome(before?.sections?.outcome)) return;
  if (!isKnownOutcome(after.sections?.outcome)) return;
  const found = await collect(
    (cursor) => storage.search({ type: 'decision', limit: 200, ...(cursor ? { cursor } : {}) }),
    100_000,
  );
  const decisions = found.filter((card) => card.id !== after.id);
  decisions.push(after);
  const cards = new Map<string, Card>();
  const ids = new Set<string>();
  for (const decision of decisions) {
    for (const id of decision.sections?.cardsUsed ?? []) ids.add(id);
  }
  for (const id of ids) {
    const card = await storage.read(id);
    if (card?.id) cards.set(card.id, card);
  }
  const profiles = deriveSourceProfiles(decisions, cards, computedAt);
  const cited = new Set<string>();
  for (const id of after.sections?.cardsUsed ?? []) {
    const source = profileSourceOf(cards.get(id) ?? { id });
    if (source) cited.add(source);
  }
  for (const source of cited) {
    const profile = profiles.get(source);
    if (profile) await localState.saveSourceProfile(profile);
  }
}
