// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Pure edits of the Lage format (ADR-0023). Only this format is persisted, never canvas-library
// state (ADR-0019). Every edit returns a new Lage with version + 1, the number the server
// expects (optimistic concurrency, board-api lage_save).

import type { EdgeKind, Lage, LageEdge } from '@worldbuilder/core';

export const EDGE_KINDS_DRAWN = ['supports', 'refutes'] as const satisfies readonly EdgeKind[];
export type DrawnEdgeKind = (typeof EDGE_KINDS_DRAWN)[number];

const GRID_X = 280;
const GRID_Y = 170;
const COLUMNS = 4;

function bump(lage: Lage, now: Date): Lage {
  return { ...lage, version: lage.version + 1, updatedAt: now.toISOString() };
}

export function emptyLage(question: string, options: string[], now = new Date()): Lage {
  return {
    question,
    options,
    cards: [],
    seats: [{ name: 'You', kind: 'human' }],
    edges: [],
    version: 1,
    updatedAt: now.toISOString(),
  };
}

/** The next free grid slot, so a placed card never lands on another one. */
export function nextFreePosition(lage: Lage): { x: number; y: number } {
  const taken = new Set(
    lage.cards.map((c) => `${Math.round(c.x / GRID_X)},${Math.round(c.y / GRID_Y)}`),
  );
  for (let i = 0; i < 10_000; i++) {
    const cx = i % COLUMNS;
    const cy = Math.floor(i / COLUMNS);
    if (!taken.has(`${cx},${cy}`)) return { x: cx * GRID_X, y: cy * GRID_Y };
  }
  return { x: 0, y: 0 };
}

export function isPlaced(lage: Lage, cardId: string): boolean {
  return lage.cards.some((c) => c.id === cardId);
}

export function placeCard(
  lage: Lage,
  cardId: string,
  x: number,
  y: number,
  now = new Date(),
): Lage {
  if (isPlaced(lage, cardId)) return lage;
  return bump({ ...lage, cards: [...lage.cards, { id: cardId, x, y }] }, now);
}

export function moveCard(lage: Lage, cardId: string, x: number, y: number, now = new Date()): Lage {
  return bump(
    { ...lage, cards: lage.cards.map((c) => (c.id === cardId ? { ...c, x, y } : c)) },
    now,
  );
}

export function removeCard(lage: Lage, cardId: string, now = new Date()): Lage {
  if (!isPlaced(lage, cardId)) return lage;
  return bump(
    {
      ...lage,
      cards: lage.cards.filter((c) => c.id !== cardId),
      edges: lage.edges.filter((e) => e.from !== cardId && e.to !== cardId),
    },
    now,
  );
}

const sameEdge = (a: LageEdge, b: Pick<LageEdge, 'from' | 'to' | 'kind'>) =>
  a.from === b.from && a.to === b.to && a.kind === b.kind;

/** Draws an edge by the human. Self-loops, unplaced endpoints and duplicates change nothing. */
export function addEdge(
  lage: Lage,
  from: string,
  to: string,
  kind: EdgeKind,
  now = new Date(),
): Lage {
  if (from === to || !isPlaced(lage, from) || !isPlaced(lage, to)) return lage;
  if (lage.edges.some((e) => sameEdge(e, { from, to, kind }))) return lage;
  return bump({ ...lage, edges: [...lage.edges, { from, to, kind, by: 'human' }] }, now);
}

export function removeEdge(lage: Lage, edge: LageEdge, now = new Date()): Lage {
  return bump({ ...lage, edges: lage.edges.filter((e) => !sameEdge(e, edge)) }, now);
}

/** Applies a change to one edge (the caller sets `by: 'human'`: a person changed it); if it then equals another edge, the two become one. */
function changeEdge(
  lage: Lage,
  edge: LageEdge,
  change: (e: LageEdge) => LageEdge,
  now: Date,
): Lage {
  const changed = change(edge);
  const edges: LageEdge[] = [];
  for (const e of lage.edges) {
    const next = sameEdge(e, edge) ? changed : e;
    if (!edges.some((kept) => sameEdge(kept, next))) edges.push(next);
  }
  return bump({ ...lage, edges }, now);
}

export function reverseEdge(lage: Lage, edge: LageEdge, now = new Date()): Lage {
  return changeEdge(lage, edge, (e) => ({ ...e, from: e.to, to: e.from, by: 'human' }), now);
}

export function setEdgeKind(lage: Lage, edge: LageEdge, kind: EdgeKind, now = new Date()): Lage {
  return changeEdge(lage, edge, (e) => ({ ...e, kind, by: 'human' }), now);
}

/** Stable key of an edge on the canvas. */
export const edgeKey = (e: Pick<LageEdge, 'from' | 'to' | 'kind'>): string =>
  `${e.from}>${e.to}:${e.kind}`;
