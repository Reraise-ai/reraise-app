// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Theme Lage helpers (ADR-0051, e-52, e-58). Votes are the lengths of the stored card-id
// lists. A source opens the placed person or organisation card that names it.

import type { Card, Lage, ThemeQuestion } from './generated/contracts.js';

export function themeVoteText(question: Pick<ThemeQuestion, 'for' | 'against'>): string {
  return `${question.for.length} for · ${question.against.length} against`;
}

/** The placed person or organisation card this source belongs to. */
export function actorCardForSource(cards: readonly Card[], source: string): Card | undefined {
  return cards.find(
    (card) =>
      (card.type === 'person' || card.type === 'organisation') &&
      (card.source === source || card.id === source),
  );
}

export function isThemeLage(
  lage: Lage,
): lage is Lage & { questions: ThemeQuestion[]; collectorCardId: string } {
  return (lage.questions?.length ?? 0) >= 2 && typeof lage.collectorCardId === 'string';
}
