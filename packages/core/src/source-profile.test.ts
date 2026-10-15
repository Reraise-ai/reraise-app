// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import type { Card } from './generated/contracts.js';
import {
  SOURCE_PROFILE_MINIMUM_N,
  deriveSourceProfiles,
  profileSourceOf,
} from './source-profile.js';

const AT = '2026-10-14T00:00:00.000Z';
const CARD = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

function card(id: string, source?: string): Card {
  return { id, format: 2, ...(source !== undefined ? { source } : {}) } as Card;
}

function decision(cardsUsed: string[], outcome: string): Card {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    format: 2,
    type: 'decision',
    sections: {
      situation: 's',
      trigger: 't',
      conditions: 'c',
      facts: 'f',
      priorities: 'p',
      action: 'a',
      alternatives: 'al',
      exclusions: 'e',
      rationale: 'r',
      cardsUsed,
      outcome,
    },
  } as Card;
}

describe('profileSourceOf', () => {
  it('uses an http(s) source, a card id source, or else the card id', () => {
    expect(profileSourceOf(card(CARD, 'https://example.invalid/a'))).toBe(
      'https://example.invalid/a',
    );
    expect(profileSourceOf(card(CARD, ' http://example.invalid/b '))).toBe(
      'http://example.invalid/b',
    );
    expect(profileSourceOf(card(CARD, OTHER))).toBe(OTHER);
    expect(profileSourceOf(card(CARD, 'Synthetic bulletin'))).toBe(CARD);
    expect(profileSourceOf(card(CARD, '   '))).toBe(CARD);
    expect(profileSourceOf({ source: 'not a uri' })).toBeUndefined();
  });
});

describe('deriveSourceProfiles', () => {
  const wire = card(CARD, 'https://example.invalid/wire');
  const cards = new Map([[CARD, wire]]);

  it('counts a known outcome once for the source, and leaves the other dimensions empty', () => {
    const profiles = deriveSourceProfiles([decision([CARD], 'Rerouted.')], cards, AT);
    const hit = profiles.get('https://example.invalid/wire');
    expect(hit?.dimensions.hitAccuracy).toEqual({ n: 1, value: 1 });
    expect(hit?.minimumN).toBe(SOURCE_PROFILE_MINIMUM_N);
    expect(hit?.computedAt).toBe(AT);
    expect(hit?.dimensions.reliability).toEqual({ n: 0 });
    expect(hit?.dimensions.topicCompetence).toEqual([]);
    expect(hit?.dimensions.agreement).toEqual({ n: 0 });
    expect(hit?.dimensions.deviation).toEqual({ n: 0 });
    expect(hit?.dimensions.sourceQuality).toEqual({ n: 0 });
    expect(hit?.dimensions.historicalPerformance).toEqual({ n: 0 });
    expect(hit?.dimensions.counterPerspectiveValue).toEqual({ n: 0 });
  });

  it('ignores an open outcome, a card that is not a decision, and a missing card', () => {
    const open = deriveSourceProfiles([decision([CARD], 'open')], cards, AT);
    expect(open.size).toBe(0);
    const claim = card(OTHER, 'https://example.invalid/wire');
    claim.type = 'claim';
    expect(deriveSourceProfiles([claim], cards, AT).size).toBe(0);
    expect(
      deriveSourceProfiles([decision(['01ARZ3NDEKTSV4RRFFQ69G5FAY'], 'Known.')], cards, AT).size,
    ).toBe(0);
  });

  it('counts the same source once per decision and again on the next outcome', () => {
    const copy = card(OTHER, 'https://example.invalid/wire');
    const both = new Map<string, Card>([
      [CARD, wire],
      [OTHER, copy],
    ]);
    const first = decision([CARD, OTHER], 'It held.');
    const second = { ...decision([CARD], 'It held again.'), id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ' };
    const once = deriveSourceProfiles([first], both, AT);
    expect(once.get('https://example.invalid/wire')?.dimensions.hitAccuracy.n).toBe(1);
    const twice = deriveSourceProfiles([first, second], both, AT);
    expect(twice.get('https://example.invalid/wire')?.dimensions.hitAccuracy).toEqual({
      n: 2,
      value: 1,
    });
  });

  it('profiles a card with no resolvable source under its own id', () => {
    const prose = card(CARD, 'A bulletin');
    const profiles = deriveSourceProfiles(
      [decision([CARD], 'Known.')],
      new Map([[CARD, prose]]),
      AT,
    );
    expect(profiles.has(CARD)).toBe(true);
    expect(profiles.has('A bulletin')).toBe(false);
  });
});
