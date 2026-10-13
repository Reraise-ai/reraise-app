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

/** Strongly connected components, sinks first. Membership does not depend on node order. */
function sinkFirstComponents(
  nodes: readonly string[],
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of outgoing.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, indices.get(next)!));
      }
    }
    if (low.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    for (;;) {
      const found = stack.pop()!;
      onStack.delete(found);
      component.push(found);
      if (found === node) break;
    }
    components.push(component);
  };
  for (const node of nodes) {
    if (!indices.has(node)) visit(node);
  }
  return components;
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
  const smaller = (found: readonly OriginRoot[]): OriginRoot =>
    found.reduce((best, cur) => (cur.originRoot < best.originRoot ? cur : best));

  // Sinks first, so a quote of a cycle keeps that root in either card order.
  const components = sinkFirstComponents([...members.keys()], outgoing);
  const label = new Map<string, OriginRoot>();
  for (const component of components) {
    const inside = new Set(component);
    const outs = [
      ...new Set(
        component
          .flatMap((rep) => [...(outgoing.get(rep) ?? [])])
          .filter((next) => !inside.has(next)),
      ),
    ];
    const made =
      outs.length === 0 ? labelOf(component) : smaller(outs.map((next) => label.get(next)!));
    for (const rep of component) label.set(rep, made);
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
