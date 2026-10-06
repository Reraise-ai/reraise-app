// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import type { Card } from './generated/contracts.js';
import { computeContentHash } from './content-hash.js';
import {
  SHARED_FIELDS,
  SHARED_PLAYER_FIELDS,
  isPublicSourceUri,
  originOf,
  shareProjection,
} from './sharing.js';

const STORE = '45aaff12-777f-40e3-a97c-8a592e1ea4f6';
const card = (extra: Partial<Card>): Card => {
  const c = {
    id: '01M1E34QM03WVTE8T1RYS3AM18',
    externalId: '01M1E34QM03WVTE8T1RYS3AM18',
    uri: `wb:${STORE}/01M1E34QM03WVTE8T1RYS3AM18`,
    format: 2,
    type: 'claim',
    title: 'Wire report announces transit restrictions',
    layer: 'said',
    author: 'human',
    source: 'https://example.org/wire/2026-09-14',
    ...extra,
  } as Omit<Card, 'contentHash'>;
  return { ...c, contentHash: computeContentHash(c) } as Card;
};
const PUBLIC = 'https://example.org/statement';

describe('isPublicSourceUri (ADR-0036)', () => {
  it('accepts http and https addresses on public host names only', () => {
    expect(isPublicSourceUri('https://example.org/a')).toBe(true);
    expect(isPublicSourceUri('HTTP://example.org/a')).toBe(true);
    for (const v of [
      undefined,
      'Own notes',
      '01M1E34QM03WVTE8T1RYS3AM18',
      `wb:${STORE}/x-14`,
      'file:///home/report.pdf',
      'https://localhost/a',
      'https://nas.local/a',
      'https://192.0.2.10/a',
      'https://[::1]/a',
      'https://',
    ]) {
      expect(isPublicSourceUri(v), String(v)).toBe(false);
    }
  });
});

describe('originOf (ADR-0036)', () => {
  it('classes a human card with a public source as external', () => {
    expect(originOf(card({})).originClass).toBe('external');
    expect(originOf(card({ layer: 'evidenced' })).originClass).toBe('external');
  });

  it('classes own experience as experience', () => {
    expect(originOf(card({ layer: 'experience', type: 'experience' })).originClass).toBe(
      'experience',
    );
  });

  it.each([
    ['a decision', { type: 'decision' }],
    ['a rule', { type: 'rule' }],
    ['a rating (own assessment)', { type: 'rating' }],
    ['an assumption', { type: 'assumption' }],
    ['a Lage', { type: 'lage' }],
    ['agent output', { author: 'agent:analyst' }],
    ['agent experience', { author: 'agent:analyst', layer: 'experience', type: 'experience' }],
    ['a legacy card of unknown author', { author: 'unknown', format: 1, layer: undefined }],
    ['an unclassified card', { layer: undefined }],
    ['a card citing free text', { source: 'Own notes' }],
    ['a card citing another card', { source: '01M1EDEAG082WZ7T7D204BHZDC' }],
    ['a card with only an origin system', { source: undefined, originSystem: 'Own wiki' }],
  ] as [string, Partial<Card>][])(
    'classes %s as a conclusion, even with a public source',
    (_w, extra) => {
      expect(originOf(card(extra)).originClass).toBe('conclusion');
    },
  );
});

describe('shareProjection (ADR-0036)', () => {
  const actor = card({
    collection: 'actors',
    type: 'person',
    worlds: ['01M1DZPW00JGXPRPG4179ZPNB8'],
    tags: ['watch'],
    class: 'C',
    visibility: 'public',
    release: 'community',
    training: true,
    status: 'checked',
    rating: 3,
    edges: [{ target: '01M1EDEAG082WZ7T7D204BHZDC', kind: 'supports', by: 'human' }],
    interests: [{ text: 'Keep the port open', source: PUBLIC }],
    redLines: [{ text: 'No night convoys', source: PUBLIC }],
    assumedGoals: [{ text: 'Raise fees', source: '01M2MYHHT07BBT348TS317FFBD' }],
    personalityType: { text: 'ISTJ', source: PUBLIC },
  });

  it('carries content and provenance only', () => {
    const shared = shareProjection(actor);
    const allowed = new Set<string>([...SHARED_FIELDS, ...SHARED_PLAYER_FIELDS, 'contentHash']);
    expect(Object.keys(shared).filter((k) => !allowed.has(k))).toEqual([]);
    for (const k of ['uri', 'externalId', 'worlds', 'tags', 'class', 'visibility', 'release']) {
      expect(shared, k).not.toHaveProperty(k);
    }
    for (const k of ['training', 'status', 'rating', 'edges', 'personalityType']) {
      expect(shared, k).not.toHaveProperty(k);
    }
    expect(shared.source).toBe(actor.source);
    expect(shared.author).toBe('human');
  });

  it('keeps only player entries with a public source and drops empty fields', () => {
    const shared = shareProjection(actor);
    expect(shared.interests).toEqual(actor.interests);
    expect(shared.redLines).toEqual(actor.redLines);
    expect(shared).not.toHaveProperty('assumedGoals');
  });

  it('hashes the projection, not the private card', () => {
    const shared = shareProjection(actor);
    const { contentHash, ...rest } = shared;
    expect(contentHash).toBe(computeContentHash(rest as never));
    expect(contentHash).not.toBe(actor.contentHash);
  });
});
