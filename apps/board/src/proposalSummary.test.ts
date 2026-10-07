// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import type { Proposal } from '@worldbuilder/core';
import { summarizeProposal } from './proposalSummary.js';
import { CARDS } from './testing/mockApi.js';

const titles = new Map(CARDS.map((c) => [c.id!, c] as const));
const [C1, C2] = CARDS.map((c) => c.id!) as [string, string];
const p = (kind: Proposal['kind'], payload: object) =>
  ({ id: 'P', author: 'agent:x', kind, payload, status: 'pending', createdAt: 't' }) as Proposal;

describe('summarizeProposal', () => {
  it('describes every proposal kind with card titles', () => {
    expect(
      summarizeProposal(p('place_card', { lageId: 'L', cardId: C1, x: 1, y: 2 }), titles),
    ).toBe('Place "Strait traffic report" at (1, 2)');
    expect(summarizeProposal(p('move_card', { lageId: 'L', cardId: C1, x: 3, y: 4 }), titles)).toBe(
      'Move "Strait traffic report" to (3, 4)',
    );
    expect(summarizeProposal(p('add_edge', { from: C1, to: C2, kind: 'supports' }), titles)).toBe(
      'Draw "Strait traffic report" supports "Minister statement"',
    );
    expect(
      summarizeProposal(p('create_card', { card: { title: 'T', layer: 'said' } }), titles),
    ).toBe('Create card "T" (said)');
    expect(summarizeProposal(p('comment', { text: 'hello' }), titles)).toBe('Comment: hello');
  });

  it('falls back to a short id for a card the screen cannot name', () => {
    expect(
      summarizeProposal(
        p('place_card', { cardId: '01JAXXXXXXXXXXXXXXXXAB1234', x: 0, y: 0 }),
        titles,
      ),
    ).toBe('Place card AB1234 at (0, 0)');
    expect(summarizeProposal(p('create_card', {}), titles)).toBe('Create card "untitled"');
  });
});
