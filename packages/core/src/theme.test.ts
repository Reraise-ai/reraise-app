// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import type { Card, Lage } from './generated/contracts.js';
import { actorCardForSource, isThemeLage, themeVoteText } from './theme.js';

const lage = {
  question: 'Vitamin D',
  options: [],
  cards: [],
  seats: [],
  edges: [],
  version: 1,
  updatedAt: '2026-10-14T12:00:00Z',
} as Lage;

describe('themeVoteText', () => {
  it('counts the cards arguing for and against', () => {
    expect(themeVoteText({ for: ['A'], against: ['B', 'C'] })).toBe('1 for · 2 against');
    expect(themeVoteText({ for: [], against: [] })).toBe('0 for · 0 against');
  });
});

describe('isThemeLage', () => {
  it('needs two questions and a collector', () => {
    expect(isThemeLage(lage)).toBe(false);
    expect(
      isThemeLage({
        ...lage,
        questions: [
          { text: 'Q1?', for: [], against: [] },
          { text: 'Q2?', for: [], against: [] },
        ],
        collectorCardId: '01M1EMA1R0AH9ZTK3YJK33TNER',
      }),
    ).toBe(true);
  });
});

describe('actorCardForSource', () => {
  const org = {
    id: '01M1EDEAG082WZ7T7D204BHZDC',
    type: 'organisation',
    source: 'https://example.org/navy',
    title: 'Navy',
  } as Card;
  const claim = {
    id: '01M1E34QM03WVTE8T1RYS3AM18',
    type: 'claim',
    source: 'https://example.org/navy',
    title: 'A claim',
  } as Card;

  it('opens the person or organisation card, not a claim that cites it', () => {
    expect(actorCardForSource([claim, org], 'https://example.org/navy')?.id).toBe(org.id);
    expect(actorCardForSource([claim, org], org.id)?.id).toBe(org.id);
    expect(actorCardForSource([claim], 'https://example.org/navy')).toBeUndefined();
  });
});
