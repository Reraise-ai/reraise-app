// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// When a decision's outcome leaves `open`, the human gets one experience card linked to that
// decision and to the cards it used (ADR-0017). A later edit of the outcome does not write
// another card.
// shortcut: a later outcome edit does not rewrite the experience card, add that when outcome review exists.

import type { Card, CardDraft, Edge, StorageAdapter } from '@worldbuilder/core';
import { isKnownOutcome } from '@worldbuilder/core';

export function experienceDraft(decision: Card): CardDraft {
  const sections = decision.sections;
  if (!decision.id || !sections) throw new Error('a decision with an id and sections is required');
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const target of [decision.id, ...sections.cardsUsed]) {
    if (seen.has(target)) continue;
    seen.add(target);
    edges.push({ target, kind: 'based_on', by: 'human' });
  }
  return {
    format: 2,
    type: 'experience',
    layer: 'experience',
    title: `Experience: ${decision.title ?? 'decision'}`,
    body: sections.outcome,
    visibility: 'private',
    edges,
    ...(decision.worlds && decision.worlds.length > 0 ? { worlds: [...decision.worlds] } : {}),
  };
}

/** Creates the experience card once, on the transition from an open outcome to a known one. */
export async function recordOutcomeExperience(
  storage: StorageAdapter,
  before: Card | undefined,
  after: Card,
): Promise<void> {
  if (isKnownOutcome(before?.sections?.outcome)) return;
  if (!isKnownOutcome(after.sections?.outcome)) return;
  await storage.create(experienceDraft(after), 'human');
}
