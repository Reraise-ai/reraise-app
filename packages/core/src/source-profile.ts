// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Source profiles are derived from known decision outcomes (ADR-0018). They are never typed in.
// shortcut: hitAccuracy.value is 1 per sample. A known outcome has no came-true mark (OQ-31).
// Replace the value with hits over samples when an outcome can record a miss. n is the hit count.

import type { Card, SourceProfile, SourceProfileDimension } from './generated/contracts.js';
import { isKnownOutcome } from './outcome.js';

/** Below this sample size the board says "insufficient data" (the schema fixtures use 5). */
export const SOURCE_PROFILE_MINIMUM_N = 5;

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const EMPTY: SourceProfileDimension = { n: 0 };

/**
 * The profiled source of a card: its `source` when that is a card id or an http(s) URI,
 * otherwise the card id. Free text is not a machine-resolvable source (sourceRef).
 */
export function profileSourceOf(card: { id?: string; source?: string }): string | undefined {
  const source = card.source?.trim();
  if (source && (ULID.test(source) || isHttpUri(source))) return source;
  return card.id;
}

function isHttpUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hitDimension(n: number): SourceProfileDimension {
  return n > 0 ? { n, value: 1 } : EMPTY;
}

function profile(source: string, n: number, computedAt: string): SourceProfile {
  return {
    source,
    computedAt,
    minimumN: SOURCE_PROFILE_MINIMUM_N,
    dimensions: {
      hitAccuracy: hitDimension(n),
      reliability: EMPTY,
      topicCompetence: [],
      agreement: EMPTY,
      deviation: EMPTY,
      sourceQuality: EMPTY,
      historicalPerformance: EMPTY,
      counterPerspectiveValue: EMPTY,
    },
  };
}

/**
 * One profile per source cited by a card in `cardsUsed` of a decision whose outcome is known.
 * The same source on two cards of one decision counts once. Other dimensions stay at n = 0
 * until their inputs exist (stances for agreement, deviation and counter-perspective value).
 */
export function deriveSourceProfiles(
  decisions: readonly Card[],
  cards: ReadonlyMap<string, Card>,
  computedAt: string,
): Map<string, SourceProfile> {
  const counts = new Map<string, number>();
  for (const decision of decisions) {
    if (decision.type !== 'decision' || !isKnownOutcome(decision.sections?.outcome)) continue;
    const cited = new Set<string>();
    for (const id of decision.sections?.cardsUsed ?? []) {
      const card = cards.get(id);
      const source = card ? profileSourceOf(card) : undefined;
      if (source) cited.add(source);
    }
    for (const source of cited) counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  const profiles = new Map<string, SourceProfile>();
  for (const [source, n] of counts) profiles.set(source, profile(source, n, computedAt));
  return profiles;
}
