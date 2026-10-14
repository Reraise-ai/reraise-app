// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Maps the Lage format to canvas nodes and edges. The canvas state is derived and never
// persisted (ADR-0019): positions and edges are written back as Lage edits.

import type { Card, Lage, Stance } from '@worldbuilder/core';
import { sourceMark } from '@worldbuilder/core/independence';
import type { CardNodeType } from './components/CardNode.js';
import type { KindEdgeType } from './components/KindEdge.js';
import { edgeKey } from './lageModel.js';

export function toNodes(
  lage: Lage,
  cards: ReadonlyMap<string, Card>,
  stances: ReadonlyMap<string, Stance>,
  selectedCardId?: string | null,
): CardNodeType[] {
  const placed = lage.cards.flatMap((p) => {
    const card = cards.get(p.id);
    return card ? [card] : [];
  });
  return lage.cards.map((p) => {
    const card = cards.get(p.id);
    const stance = stances.get(p.id);
    const mark = card ? sourceMark(placed, p.id) : undefined;
    return {
      id: p.id,
      type: 'card' as const,
      position: { x: p.x, y: p.y },
      selected: p.id === selectedCardId,
      data: {
        cardId: p.id,
        ...(card ? { card } : {}),
        ...(stance ? { stance } : {}),
        ...(mark ? { sourceMark: mark } : {}),
      },
    };
  });
}

export function toEdges(lage: Lage, selectedKey?: string | null): KindEdgeType[] {
  return lage.edges.map((e) => ({
    id: edgeKey(e),
    type: 'kind' as const,
    source: e.from,
    target: e.to,
    selected: edgeKey(e) === selectedKey,
    ariaLabel: `${e.kind} edge`,
    data: { kind: e.kind, by: e.by },
  }));
}
