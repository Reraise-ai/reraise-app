// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { toEdges, toNodes } from './flowMapping.js';
import { CARDS, makeLage } from './testing/mockApi.js';

const [C1, C2] = CARDS;

describe('Lage to canvas mapping', () => {
  const lage = makeLage({
    edges: [{ from: C1!.id!, to: C2!.id!, kind: 'refutes', by: 'agent:scout' }],
  });
  const cards = new Map(CARDS.map((c) => [c.id!, c] as const));

  it('places a node per placement at its x and y, carrying the card and the stance', () => {
    const stance = {
      cardId: C1!.id!,
      position: 'believed' as const,
      weight: 1,
      updatedAt: 't',
      history: [],
    };
    const nodes = toNodes(lage, cards, new Map([[C1!.id!, stance]]), C2!.id);
    expect(nodes.map((n) => [n.id, n.position.x, n.position.y, n.selected])).toEqual([
      [C1!.id, 0, 0, false],
      [C2!.id, 280, 0, true],
    ]);
    expect(nodes[0]!.data.stance).toBe(stance);
    expect(nodes[1]!.data.stance).toBeUndefined();
    expect(nodes[0]!.data.card?.title).toBe(C1!.title);
    expect(nodes.map((n) => n.data.sourcePass)).toEqual([
      '2 findings · 1 origin',
      '2 findings · 1 origin',
    ]);
  });

  it('marks one source, and two independent sources of the same statement', () => {
    const statement = 'Transits fell by a third.';
    const a = { ...C1!, source: 'https://example.org/a', body: statement };
    const b = { ...C2!, source: 'https://example.org/b', body: statement };
    const nodes = toNodes(
      lage,
      new Map([
        [a.id!, a],
        [b.id!, b],
      ]),
      new Map(),
    );
    expect(nodes.map((n) => n.data.sourceMark)).toEqual([
      'journalistic-standard',
      'journalistic-standard',
    ]);
    const alone = toNodes(lage, new Map([[a.id!, a]]), new Map());
    expect(alone[0]!.data.sourceMark).toBe('one-source');
    expect(alone[1]!.data.sourceMark).toBeUndefined();
  });

  it('keeps a placement whose card is not readable, without a card', () => {
    const nodes = toNodes(lage, new Map(), new Map());
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.data.card).toBeUndefined();
  });

  it('maps edges with kind and author in data and marks the selected one', () => {
    const [edge] = toEdges(lage);
    expect(edge).toMatchObject({
      source: C1!.id,
      target: C2!.id,
      data: { kind: 'refutes', by: 'agent:scout' },
    });
    expect(toEdges(lage, edge!.id)[0]!.selected).toBe(true);
    expect(toEdges(lage, 'other')[0]!.selected).toBe(false);
  });
});
