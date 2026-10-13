// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import type { Card, EdgeKind } from './generated/contracts.js';
import { independenceOf, originRoots } from './independence.js';

function card(
  id: string,
  extra: {
    source?: string;
    contentHash?: string;
    edges?: { target: string; kind: EdgeKind }[];
  } = {},
): Card {
  return {
    id,
    format: 2,
    type: 'claim',
    title: id,
    author: 'human',
    ...extra,
    edges: extra.edges?.map((edge) => ({ ...edge, by: 'human' as const })),
  } as Card;
}

function rootsOf(cards: Card[]) {
  const assigned = originRoots(cards);
  return Object.fromEntries(cards.map((c) => [c.id, assigned.get(c.id)]));
}

describe('originRoots (ADR-0009)', () => {
  it('counts two cards with the same content hash as one unknown root', () => {
    const copies = [
      card('B', { contentHash: 'sha256:aa' }),
      card('A', { contentHash: 'sha256:aa' }),
    ];
    expect(rootsOf(copies)).toEqual({
      A: { originRoot: 'A', originKnown: false },
      B: { originRoot: 'A', originKnown: false },
    });
    expect(independenceOf([...originRoots(copies).values()])).toEqual({ findings: 2, origins: 1 });
  });

  it('counts two cards with the same source URI as one known root', () => {
    const copies = [
      card('A', { source: 'https://example.org/wire' }),
      card('B', { source: 'https://example.org/wire' }),
    ];
    expect(rootsOf(copies).A).toEqual({
      originRoot: 'https://example.org/wire',
      originKnown: true,
    });
    expect(rootsOf(copies).B).toEqual(rootsOf(copies).A);
  });

  it('uses the smaller source when two copies name different source URIs', () => {
    const copies = [
      card('A', { contentHash: 'sha256:aa', source: 'https://z.example/late' }),
      card('B', { contentHash: 'sha256:aa', source: 'https://a.example/early' }),
    ];
    expect(rootsOf(copies).A?.originRoot).toBe('https://a.example/early');
    expect(rootsOf(copies).B?.originKnown).toBe(true);
  });

  it('follows a quote chain of cites and based_on to the sourced card', () => {
    const cards = [
      card('media', { edges: [{ target: 'analyst', kind: 'cites' }] }),
      card('analyst', { edges: [{ target: 'wire', kind: 'based_on' }] }),
      card('wire', { source: 'https://example.org/wire' }),
    ];
    const roots = rootsOf(cards);
    expect(roots.media).toEqual({ originRoot: 'https://example.org/wire', originKnown: true });
    expect(roots.analyst).toEqual(roots.media);
    expect(roots.wire).toEqual(roots.media);
    expect(independenceOf([...originRoots(cards).values()]).origins).toBe(1);
  });

  it('keeps a sourced card that a cycle also cites, in either edge order', () => {
    const mixed = (sourceFirst: boolean) => [
      card('A', {
        edges: sourceFirst
          ? [
              { target: 'C', kind: 'cites' as const },
              { target: 'B', kind: 'cites' as const },
            ]
          : [
              { target: 'B', kind: 'cites' as const },
              { target: 'C', kind: 'cites' as const },
            ],
      }),
      card('B', { edges: [{ target: 'A', kind: 'cites' }] }),
      card('C', { source: 'https://example.org/c' }),
    ];
    for (const cards of [mixed(true), mixed(false)]) {
      const roots = rootsOf(cards);
      expect(roots.C).toEqual({ originRoot: 'https://example.org/c', originKnown: true });
      expect(roots.A).toEqual(roots.C);
      expect(roots.B).toEqual(roots.C);
    }
  });

  it('treats a cite cycle as one unknown root', () => {
    const cards = [
      card('B', { edges: [{ target: 'A', kind: 'cites' }] }),
      card('A', { edges: [{ target: 'B', kind: 'cites' }] }),
    ];
    expect(rootsOf(cards)).toEqual({
      A: { originRoot: 'A', originKnown: false },
      B: { originRoot: 'A', originKnown: false },
    });
  });

  it('keeps two cards with no source and no chain as two unknown roots', () => {
    const cards = [card('A'), card('B')];
    const roots = rootsOf(cards);
    expect(roots.A).toEqual({ originRoot: 'A', originKnown: false });
    expect(roots.B).toEqual({ originRoot: 'B', originKnown: false });
    expect(independenceOf([...originRoots(cards).values()])).toEqual({ findings: 2, origins: 2 });
  });

  it('does not follow a supports edge or an edge whose target is outside the set', () => {
    const linked = [
      card('A', { source: 'https://example.org/a', edges: [{ target: 'B', kind: 'supports' }] }),
      card('B', { source: 'https://example.org/b' }),
    ];
    expect(rootsOf(linked).A?.originRoot).toBe('https://example.org/a');
    expect(rootsOf(linked).B?.originRoot).toBe('https://example.org/b');

    const dangling = [card('C', { edges: [{ target: 'missing', kind: 'cites' }] })];
    expect(rootsOf(dangling).C).toEqual({ originRoot: 'C', originKnown: false });
    const sourced = [
      card('D', { source: 'https://example.org/d', edges: [{ target: 'missing', kind: 'cites' }] }),
    ];
    expect(rootsOf(sourced).D).toEqual({ originRoot: 'https://example.org/d', originKnown: true });
  });

  it('follows a copy to the unsourced card it cites, including a reprint of the same source', () => {
    const cards = [
      card('article', {
        source: 'https://media.example/story',
        edges: [{ target: 'primary', kind: 'cites' }],
      }),
      card('primary'),
      card('reprint', { source: 'https://media.example/story' }),
    ];
    const roots = rootsOf(cards);
    expect(roots.primary).toEqual({ originRoot: 'primary', originKnown: false });
    expect(roots.article).toEqual(roots.primary);
    expect(roots.reprint).toEqual(roots.primary);
  });

  it('keeps two cited sources apart when one card cites both', () => {
    const fork = (first: 'wire-a' | 'wire-b', second: 'wire-a' | 'wire-b') => [
      card('speaker', {
        edges: [
          { target: first, kind: 'cites' },
          { target: second, kind: 'cites' },
        ],
      }),
      card('wire-a', { source: 'https://example.org/a' }),
      card('wire-b', { source: 'https://example.org/b' }),
    ];
    for (const cards of [fork('wire-a', 'wire-b'), fork('wire-b', 'wire-a')]) {
      const roots = rootsOf(cards);
      expect(roots['wire-a']).toEqual({ originRoot: 'https://example.org/a', originKnown: true });
      expect(roots['wire-b']).toEqual({ originRoot: 'https://example.org/b', originKnown: true });
      expect(roots.speaker).toEqual(roots['wire-a']);
      expect(independenceOf([...originRoots(cards).values()]).origins).toBe(2);
    }
  });

  it('does not collapse two unknown primaries that one copied text cites', () => {
    const copies = [
      card('copy-a', {
        contentHash: 'sha256:aa',
        source: 'https://media.example/story',
        edges: [{ target: 'primary-b', kind: 'cites' }],
      }),
      card('copy-b', {
        contentHash: 'sha256:aa',
        source: 'https://media.example/story',
        edges: [{ target: 'primary-a', kind: 'cites' }],
      }),
      card('primary-a'),
      card('primary-b'),
    ];
    const roots = rootsOf(copies);
    expect(roots['primary-a']).toEqual({ originRoot: 'primary-a', originKnown: false });
    expect(roots['primary-b']).toEqual({ originRoot: 'primary-b', originKnown: false });
    expect(roots['copy-a']).toEqual(roots['primary-a']);
    expect(roots['copy-b']).toEqual(roots['primary-a']);
    expect(independenceOf([...originRoots(copies).values()]).origins).toBe(2);
  });

  it('counts an empty set as no findings', () => {
    expect(independenceOf([])).toEqual({ findings: 0, origins: 0 });
    expect(originRoots([]).size).toBe(0);
  });

  it('gives a quote of a cycle that cycle root, in either card order', () => {
    const quoted = [
      card('A', { edges: [{ target: 'B', kind: 'cites' }] }),
      card('B', { edges: [{ target: 'A', kind: 'cites' }] }),
      card('media', { edges: [{ target: 'A', kind: 'cites' }] }),
    ];
    for (const cards of [quoted, [...quoted].reverse()]) {
      const roots = rootsOf(cards);
      expect(roots.A).toEqual({ originRoot: 'A', originKnown: false });
      expect(roots.B).toEqual(roots.A);
      expect(roots.media).toEqual(roots.A);
      expect(independenceOf([...originRoots(cards).values()])).toEqual({
        findings: 3,
        origins: 1,
      });
    }
  });

  it('keeps two cited cycles apart and gives the quote the smaller root', () => {
    const quoted = [
      card('X', {
        edges: [
          { target: 'A', kind: 'cites' },
          { target: 'C', kind: 'cites' },
        ],
      }),
      card('A', { edges: [{ target: 'B', kind: 'cites' }] }),
      card('B', { edges: [{ target: 'A', kind: 'cites' }] }),
      card('C', { edges: [{ target: 'D', kind: 'cites' }] }),
      card('D', { edges: [{ target: 'C', kind: 'cites' }] }),
    ];
    const cyclesFirst = [
      card('A', { edges: [{ target: 'B', kind: 'cites' }] }),
      card('B', { edges: [{ target: 'A', kind: 'cites' }] }),
      card('C', { edges: [{ target: 'D', kind: 'cites' }] }),
      card('D', { edges: [{ target: 'C', kind: 'cites' }] }),
      card('X', {
        edges: [
          { target: 'A', kind: 'cites' },
          { target: 'C', kind: 'cites' },
        ],
      }),
    ];
    for (const cards of [quoted, cyclesFirst]) {
      const roots = rootsOf(cards);
      expect(roots.A).toEqual({ originRoot: 'A', originKnown: false });
      expect(roots.B).toEqual(roots.A);
      expect(roots.C).toEqual({ originRoot: 'C', originKnown: false });
      expect(roots.D).toEqual(roots.C);
      expect(roots.X).toEqual(roots.A);
      expect(independenceOf([...originRoots(cards).values()]).origins).toBe(2);
    }
  });

  it('gives a card that cites a cycle and a sourced sink the smaller root', () => {
    const cards = [
      card('A', {
        edges: [
          { target: 'B', kind: 'cites' },
          { target: 'S', kind: 'cites' },
        ],
      }),
      card('B', { edges: [{ target: 'C', kind: 'cites' }] }),
      card('C', { edges: [{ target: 'B', kind: 'cites' }] }),
      card('S', { source: 'https://example.org/s' }),
    ];
    const roots = rootsOf(cards);
    expect(roots.B).toEqual({ originRoot: 'B', originKnown: false });
    expect(roots.C).toEqual(roots.B);
    expect(roots.S).toEqual({ originRoot: 'https://example.org/s', originKnown: true });
    expect(roots.A).toEqual(roots.B);
    expect(independenceOf([...originRoots(cards).values()]).origins).toBe(2);
  });
});
