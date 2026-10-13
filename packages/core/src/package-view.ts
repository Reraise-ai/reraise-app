// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// A context package for anyone but the screen names only cards that are in the package
// (AC-18). The screen keeps the stored cards. A rule that states a stance, or that names a
// card outside the package, is left out and only counted.

import type { Card, DisclosureTarget, RuleCondition } from './generated/contracts.js';
import { computeContentHash } from './content-hash.js';

export interface PackageView {
  readonly cards: Card[];
  /** Cards left out. A count only, never their ids. */
  readonly withheld: number;
}

function projectEdges(card: Card, visible: ReadonlySet<string>): Card {
  if (card.edges === undefined) return card;
  const edges = card.edges.filter((edge) => visible.has(edge.target));
  if (edges.length === card.edges.length) return card;
  const next = { ...card };
  delete next.edges;
  return edges.length > 0 ? { ...next, edges } : next;
}

function projectLage(card: Card, visible: ReadonlySet<string>): Card {
  const lage = card.lage;
  if (lage === undefined) return card;
  const placements = lage.cards.filter((placement) => visible.has(placement.id));
  const edges = lage.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
  if (placements.length === lage.cards.length && edges.length === lage.edges.length) return card;
  return { ...card, lage: { ...lage, cards: placements, edges } };
}

/**
 * A decision that would name no remaining card cannot stay: `cardsUsed` needs one id.
 * `null` means leave the card out.
 */
function projectDecision(card: Card, visible: ReadonlySet<string>): Card | null {
  const sections = card.sections;
  if (sections === undefined) return card;
  const cardsUsed = sections.cardsUsed.filter((id) => visible.has(id));
  if (cardsUsed.length === sections.cardsUsed.length) return card;
  if (cardsUsed.length === 0) return null;
  return { ...card, sections: { ...sections, cardsUsed } };
}

/** Drop the rendered body once the structured fields no longer match it. The body is not hashed. */
function viewOf(card: Card): Card {
  const next = { ...card };
  delete next.body;
  return { ...next, contentHash: computeContentHash(next) };
}

function conditionNames(condition: RuleCondition): readonly string[] {
  switch (condition.kind) {
    case 'card_on_lage':
    case 'stance':
      return [condition.card];
    case 'card_field':
    case 'tag':
      return condition.card === undefined ? [] : [condition.card];
    case 'edge':
      return [condition.from, condition.to].filter((id): id is string => id !== undefined);
    default: {
      const unexpected: never = condition;
      throw new Error(`Unhandled rule condition: ${JSON.stringify(unexpected)}`);
    }
  }
}

/**
 * A rule is withheld whole. Dropping one condition would state a different rule (ADR-0013).
 * A stance condition is withheld even when the card it names is in the package.
 */
function ruleWithheld(card: Card, visible: ReadonlySet<string>): boolean {
  const rule = card.rule;
  if (rule === undefined) return false;
  return [...rule.when, ...(rule.unless ?? [])].some(
    (condition) =>
      condition.kind === 'stance' || conditionNames(condition).some((id) => !visible.has(id)),
  );
}

function project(card: Card, visible: ReadonlySet<string>): Card | null {
  if (ruleWithheld(card, visible)) return null;
  const withEdges = projectEdges(card, visible);
  const withLage = projectLage(withEdges, visible);
  const withDecision = projectDecision(withLage, visible);
  if (withDecision === null) return null;
  const structuredChanged =
    withDecision.lage !== card.lage || withDecision.sections !== card.sections;
  return structuredChanged ? viewOf(withDecision) : withDecision;
}

/**
 * The cards a context package may carry for `target`. The screen receives the stored cards.
 * Any other target receives a view. An edge, a placement or a `cardsUsed` id outside that
 * view is dropped. A decision that would then name no card is left out and only counted.
 * So is a rule that states a stance, or that names a card outside the view.
 */
export function cardsForPackage(cards: readonly Card[], target: DisclosureTarget): PackageView {
  if (target === 'screen') return { cards: [...cards], withheld: 0 };
  let current = [...cards];
  let withheld = 0;
  for (;;) {
    const visible = new Set(current.map((card) => card.id));
    const next: Card[] = [];
    let dropped = 0;
    for (const card of current) {
      const view = project(card, visible);
      if (view === null) {
        dropped++;
        continue;
      }
      next.push(view);
    }
    withheld += dropped;
    if (dropped === 0) return { cards: next, withheld };
    current = next;
  }
}
