// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import {
  addEdge,
  edgeKey,
  emptyLage,
  moveCard,
  nextFreePosition,
  placeCard,
  removeCard,
  removeEdge,
  reverseEdge,
  setEdgeKind,
} from './lageModel.js';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const base = () =>
  placeCard(placeCard(emptyLage('Q?', ['A', 'B'], NOW), 'A', 0, 0, NOW), 'B', 280, 0, NOW);

describe('Lage edits', () => {
  it('starts at version 1 with a human seat', () => {
    const l = emptyLage('Q?', [], NOW);
    expect(l).toMatchObject({ version: 1, cards: [], edges: [], seats: [{ kind: 'human' }] });
  });

  it('bumps the version by one and stamps updatedAt on every change', () => {
    const l = base();
    expect(l.version).toBe(3);
    expect(moveCard(l, 'A', 5, 6, NOW)).toMatchObject({ version: 4, updatedAt: NOW.toISOString() });
  });

  it('places a card once', () => {
    const l = base();
    expect(placeCard(l, 'A', 9, 9, NOW)).toBe(l);
    expect(l.cards).toHaveLength(2);
  });

  it('moves a card', () => {
    expect(moveCard(base(), 'B', 1, 2, NOW).cards[1]).toEqual({ id: 'B', x: 1, y: 2 });
  });

  it('draws an edge by the human, ignoring self-loops, unplaced cards and duplicates', () => {
    const l = addEdge(base(), 'A', 'B', 'supports', NOW);
    expect(l.edges).toEqual([{ from: 'A', to: 'B', kind: 'supports', by: 'human' }]);
    expect(addEdge(l, 'A', 'B', 'supports', NOW)).toBe(l);
    expect(addEdge(l, 'A', 'A', 'supports', NOW)).toBe(l);
    expect(addEdge(l, 'A', 'Z', 'supports', NOW)).toBe(l);
    expect(addEdge(l, 'A', 'B', 'refutes', NOW).edges).toHaveLength(2);
  });

  it('reverses, retypes and deletes an edge', () => {
    const l = addEdge(base(), 'A', 'B', 'supports', NOW);
    const e = l.edges[0]!;
    expect(reverseEdge(l, e, NOW).edges[0]).toMatchObject({ from: 'B', to: 'A', kind: 'supports' });
    expect(setEdgeKind(l, e, 'refutes', NOW).edges[0]).toMatchObject({ kind: 'refutes' });
    expect(removeEdge(l, e, NOW).edges).toEqual([]);
  });

  it('merges an edge that becomes equal to another after reversing or retyping', () => {
    let l = addEdge(base(), 'A', 'B', 'supports', NOW);
    l = addEdge(l, 'B', 'A', 'supports', NOW);
    expect(reverseEdge(l, l.edges[0]!, NOW).edges).toEqual([
      { from: 'B', to: 'A', kind: 'supports', by: 'human' },
    ]);
    let m = addEdge(base(), 'A', 'B', 'supports', NOW);
    m = addEdge(m, 'A', 'B', 'refutes', NOW);
    expect(setEdgeKind(m, m.edges[0]!, 'refutes', NOW).edges).toHaveLength(1);
  });

  it('removing a card removes its edges', () => {
    const l = removeCard(addEdge(base(), 'A', 'B', 'supports', NOW), 'A', NOW);
    expect(l.cards.map((c) => c.id)).toEqual(['B']);
    expect(l.edges).toEqual([]);
  });

  it('finds the next free grid slot', () => {
    const l = base();
    expect(nextFreePosition(l)).toEqual({ x: 560, y: 0 });
    expect(nextFreePosition(emptyLage('Q', [], NOW))).toEqual({ x: 0, y: 0 });
    let big = emptyLage('Q', [], NOW);
    for (let i = 0; i < 5; i++) {
      const { x, y } = nextFreePosition(big);
      big = placeCard(big, `c${i}`, x, y, NOW);
    }
    expect(nextFreePosition(big)).toEqual({ x: 280, y: 170 });
  });

  it('keys an edge by direction and kind', () => {
    expect(edgeKey({ from: 'A', to: 'B', kind: 'supports' })).not.toBe(
      edgeKey({ from: 'B', to: 'A', kind: 'supports' }),
    );
  });

  it('persists only Lage fields, no canvas-library state (ADR-0019)', () => {
    expect(Object.keys(base()).sort()).toEqual(
      ['cards', 'edges', 'options', 'question', 'seats', 'updatedAt', 'version'].sort(),
    );
  });
});

describe('a human change takes over an edge', () => {
  const agentEdge = () => ({
    ...base(),
    edges: [{ from: 'A', to: 'B', kind: 'supports' as const, by: 'agent:scout' as const }],
  });
  it('sets by human when reversing', () => {
    const l = agentEdge();
    expect(reverseEdge(l, l.edges[0]!, NOW).edges[0]).toMatchObject({ from: 'B', by: 'human' });
  });
  it('sets by human when changing the kind', () => {
    const l = agentEdge();
    expect(setEdgeKind(l, l.edges[0]!, 'refutes', NOW).edges[0]).toMatchObject({
      kind: 'refutes',
      by: 'human',
    });
  });
});
