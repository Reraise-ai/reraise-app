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
  it('accepts http and https addresses on public host names', () => {
    for (const v of [
      'https://example.org/a',
      'HTTP://example.org/a',
      'https://example.org./a',
      'https://news.example.com/path/with@sign',
      'https://example.org:8443/a?q=1#x',
    ]) {
      expect(isPublicSourceUri(v), v).toBe(true);
    }
  });

  it.each([
    ['no value', undefined],
    ['free text', 'Own notes'],
    ['a card id', '01M1E34QM03WVTE8T1RYS3AM18'],
    ['a wb: URI', `wb:${STORE}/x-14`],
    ['a file URI', 'file:///home/report.pdf'],
    ['an empty host', 'https://'],
    ['a single-label host', 'https://intranet/a'],
    ['a single-label host with a trailing dot', 'https://server./a'],
    ['localhost', 'https://localhost/a'],
    ['a .localhost name', 'https://app.localhost/a'],
    ['a .local name', 'https://nas.local/a'],
    ['a .internal name', 'https://wiki.internal/a'],
    ['a .lan name', 'https://router.lan/a'],
    ['a home.arpa name', 'https://nas.home.arpa/a'],
    ['a .corp name', 'https://share.corp/a'],
    ['an .intranet name', 'https://portal.intranet/a'],
    ['a .test name', 'https://site.test/a'],
    ['an .example name', 'https://site.example/a'],
    ['an .invalid name', 'https://worldbuilder.invalid/a'],
    ['an .onion name', 'https://abcdefghijklmnop.onion/a'],
    ['an .arpa name', 'https://1.0.0.127.in-addr.arpa/a'],
    ['a trailing-dot private name', 'https://nas.local./a'],
    ['an IPv4 literal', 'https://192.0.2.10/a'],
    ['an IPv4 literal with a trailing dot', 'https://192.0.2.10./a'],
    ['a numeric last label', 'https://host.123/a'],
    ['a hexadecimal IPv4 form', 'https://0x7f000001/a'],
    ['an IPv6 literal', 'https://[::1]/a'],
    ['nip.io', 'https://192.0.2.10.nip.io/a'],
    ['sslip.io', 'https://192-0-2-10.sslip.io/a'],
    ['xip.io', 'https://app.xip.io/a'],
    ['a dotted IPv4 inside another domain', 'https://198.51.100.7.wildcard.example.com/a'],
    ['a dashed IPv4 label', 'https://198-51-100-7.wildcard.example.com/a'],
    ['user information', 'https://user@example.org/a'],
    ['user and password', 'https://user:secret@example.org/a'],
    ['an empty user', 'https://:x@example.org/a'],
  ])('rejects %s', (_what, value) => {
    expect(isPublicSourceUri(value)).toBe(false);
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

  it('accepts the allow-listed types trimmed and in any case', () => {
    for (const type of [' Claim ', 'EVENT', 'Organisation', 'topic', 'evidence', 'source']) {
      expect(originOf(card({ type })).originClass, type).toBe('external');
    }
  });

  it.each([
    ['a decision', { type: 'decision' }],
    ['a decision in upper case', { type: 'Decision' }],
    ['a padded rule', { type: ' rule ' }],
    ['a rule', { type: 'rule' }],
    ['a rating (own assessment)', { type: 'rating' }],
    ['a rating in mixed case', { type: 'RaTiNg' }],
    ['an assumption', { type: 'assumption' }],
    ['a Lage', { type: 'lage' }],
    ['an unknown type', { type: 'memo' }],
    ['an analysis type', { type: 'analysis' }],
    ['an empty type', { type: ' ' }],
    ['an experience-layer decision', { type: 'decision', layer: 'experience' }],
    ['agent output', { author: 'agent:analyst' }],
    ['agent experience', { author: 'agent:analyst', layer: 'experience', type: 'experience' }],
    ['a legacy card of unknown author', { author: 'unknown', format: 1, layer: undefined }],
    ['an unclassified card', { layer: undefined }],
    ['a card citing free text', { source: 'Own notes' }],
    ['a card citing another card', { source: '01M1EDEAG082WZ7T7D204BHZDC' }],
    ['a card citing a private host', { source: 'https://wiki.internal/page' }],
    ['a card with only an origin system', { source: undefined, originSystem: 'Own wiki' }],
  ] as [string, Partial<Card>][])('classes %s as a conclusion', (_w, extra) => {
    expect(originOf(card(extra)).originClass).toBe('conclusion');
  });
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
    expect(shareProjection({ ...actor, originSystem: 'Own wiki' })).not.toHaveProperty(
      'originSystem',
    );
  });

  it('drops any source that is not a public address, also on own experience', () => {
    const experience = card({ type: 'experience', layer: 'experience', source: 'Own notes' });
    expect(shareProjection(experience)).not.toHaveProperty('source');
    const userinfo = card({ source: 'https://user:secret@example.org/a' });
    expect(shareProjection(userinfo)).not.toHaveProperty('source');
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
