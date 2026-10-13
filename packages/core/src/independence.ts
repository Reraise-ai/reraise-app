// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Origin roots are derived at read time (ADR-0009). They are never stored on a card.
// Cards with the same contentHash or the same source URI are one copy. A cites or
// based_on edge points from one copy at another. A copy that cites nothing further
// in this set is a root: its source URI, or its smallest card id when it has no
// source. A copy that cites further keeps one of those roots (the smallest label)
// and does not merge the roots it cites. A cycle is one root. A missing target
// and a supports edge are not followed.

import type { Card, ContextIndependence } from './generated/contracts.js';

export interface OriginRoot {
  /** Source URI of the root, or the root card's id when the origin is unknown. */
  readonly originRoot: string;
  readonly originKnown: boolean;
}

function isChain(kind: string): boolean {
  return kind === 'cites' || kind === 'based_on';
}

/**
 * Origin root of every card in `cards`. The caller passes the cards in scope,
 * for example the cards a disclosure gate has already cleared.
 */
export function originRoots(cards: readonly Card[]): Map<string, OriginRoot> {
  const byId = new Map<string, Card>();
  for (const card of cards) byId.set(card.id, card);

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) {
      const next = parent.get(current);
      if (next === undefined) {
        parent.set(current, current);
        return current;
      }
      current = next;
    }
    return current;
  };
  const union = (a: string, b: string): void => {
    const left = find(a);
    const right = find(b);
    if (left === right) return;
    if (left < right) parent.set(right, left);
    else parent.set(left, right);
  };
  const uniteBy = (keyOf: (card: Card) => string | undefined): void => {
    const first = new Map<string, string>();
    for (const card of byId.values()) {
      const key = keyOf(card);
      if (!key) continue;
      const previous = first.get(key);
      if (previous === undefined) first.set(key, card.id);
      else union(previous, card.id);
    }
  };

  for (const id of byId.keys()) find(id);
  uniteBy((card) => card.contentHash);
  uniteBy((card) => card.source);

  const members = new Map<string, Card[]>();
  const outgoing = new Map<string, Set<string>>();
  for (const card of byId.values()) {
    const rep = find(card.id);
    const group = members.get(rep);
    if (group) group.push(card);
    else members.set(rep, [card]);
    if (!outgoing.has(rep)) outgoing.set(rep, new Set());
  }
  for (const card of byId.values()) {
    const from = find(card.id);
    for (const edge of card.edges ?? []) {
      if (!isChain(edge.kind) || !byId.has(edge.target)) continue;
      const to = find(edge.target);
      if (to !== from) outgoing.get(from)!.add(to);
    }
  }

  const labelOf = (reps: readonly string[]): OriginRoot => {
    const grouped = reps.flatMap((rep) => members.get(rep) ?? []);
    const sources = [
      ...new Set(grouped.flatMap((card) => (card.source ? [card.source] : []))),
    ].sort();
    if (sources.length > 0) return { originRoot: sources[0]!, originKnown: true };
    const ids = grouped.map((card) => card.id).sort();
    return { originRoot: ids[0]!, originKnown: false };
  };

  const label = new Map<string, OriginRoot>();
  for (const rep of members.keys()) {
    if ((outgoing.get(rep)?.size ?? 0) === 0) label.set(rep, labelOf([rep]));
  }

  const rootLabels = (rep: string, stack: Set<string>): OriginRoot[] => {
    const outs = outgoing.get(rep);
    if (!outs || outs.size === 0) return [label.get(rep)!];
    if (stack.has(rep)) return [];
    stack.add(rep);
    const found = [...outs].flatMap((next) => rootLabels(next, stack));
    stack.delete(rep);
    return found;
  };
  const smaller = (found: readonly OriginRoot[]): OriginRoot =>
    found.reduce((best, cur) => (cur.originRoot < best.originRoot ? cur : best));

  for (const rep of members.keys()) {
    if (label.has(rep)) continue;
    const found = rootLabels(rep, new Set());
    if (found.length > 0) label.set(rep, smaller(found));
  }

  for (const rep of members.keys()) {
    if (label.has(rep)) continue;
    const seen = new Set<string>();
    const pile = [rep];
    while (pile.length > 0) {
      const current = pile.pop()!;
      if (seen.has(current) || label.has(current)) continue;
      seen.add(current);
      for (const next of outgoing.get(current) ?? []) pile.push(next);
    }
    const made = labelOf([...seen]);
    for (const id of seen) label.set(id, made);
  }

  const assigned = new Map<string, OriginRoot>();
  for (const [rep, group] of members) {
    const root = label.get(rep)!;
    for (const card of group) assigned.set(card.id, root);
  }
  return assigned;
}

/** 'N findings · M origins' over derived roots. M is the number of distinct roots. */
export function independenceOf(
  roots: readonly Pick<OriginRoot, 'originRoot'>[],
): ContextIndependence {
  return {
    findings: roots.length,
    origins: new Set(roots.map((root) => root.originRoot)).size,
  };
}
