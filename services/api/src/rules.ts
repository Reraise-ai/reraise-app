// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// rules_evaluate (ADR-0013): which of the user's rules fire on a Lage, and why. A rule is the
// `rule` field of a card of type rule. The result is a list of fired / not fired with the
// triggering card ids: no percentage, no score, no recommendation. Only the accepted state of
// the store counts (proposals never do, ADR-0011).
//
// For a non-screen target, a rule with a stance condition or with a condition on a card the
// gate does not clear for that target is omitted and only counted in `withheld`; so is a rule
// card the gate does not clear.

import type {
  Card,
  DisclosureTarget,
  Lage,
  Rule,
  RuleCondition,
  RuleConditionRef,
  RuleEvaluation,
  RuleResult,
} from '@worldbuilder/core';
import { targetOf, type Principal } from './auth.js';
import { readLage } from './lage.js';
import { HttpError } from './problem.js';
import { collect, stanceFor, type Services } from './services.js';

type Outcome = { state: 'met'; cards: string[] } | { state: 'unmet' } | { state: 'unknown' };

interface Env {
  readonly lage: Lage;
  readonly target: DisclosureTarget;
  /** Cards on the Lage by id (those the target may see; others are absent). */
  readonly visible: ReadonlyMap<string, Card>;
  /** Some card of the Lage is hidden from the target. */
  readonly hiddenOnLage: ReadonlySet<string>;
  readonly s: Services;
}

const unmet: Outcome = { state: 'unmet' };
const unknown: Outcome = { state: 'unknown' };

/** Card ids a condition names. A missing card is refused on write and unknown on evaluation. */
function referencedCards(c: RuleCondition): string[] {
  switch (c.kind) {
    case 'card_on_lage':
    case 'stance':
      return [c.card];
    case 'card_field':
    case 'tag':
      return c.card ? [c.card] : [];
    case 'edge':
      return [c.from, c.to].filter((x): x is string => x !== undefined);
  }
}

/** Every card id the rule names, once. */
export function cardsNamedBy(rule: Rule): string[] {
  const ids = new Set<string>();
  for (const condition of [...rule.when, ...(rule.unless ?? [])]) {
    for (const id of referencedCards(condition)) ids.add(id);
  }
  return [...ids];
}

/** Does a Lage edge that the condition matches have an end the target may not see? */
function edgeTouchesHidden(env: Env, c: Extract<RuleCondition, { kind: 'edge' }>): boolean {
  return env.lage.edges.some(
    (e) =>
      e.kind === c.edgeKind &&
      (c.from === undefined || e.from === c.from) &&
      (c.to === undefined || e.to === c.to) &&
      (env.hiddenOnLage.has(e.from) || env.hiddenOnLage.has(e.to)),
  );
}

async function evaluateCondition(env: Env, c: RuleCondition): Promise<Outcome> {
  const onLage = new Set(env.lage.cards.map((p) => p.id));
  switch (c.kind) {
    case 'card_on_lage':
      return onLage.has(c.card) ? { state: 'met', cards: [c.card] } : unmet;
    case 'card_field': {
      const matches = (card: Card) => String(card[c.field as keyof Card] ?? '') === c.equals;
      return byCard(env, c.card, matches, onLage);
    }
    case 'tag':
      return byCard(env, c.card, (card) => (card.tags ?? []).includes(c.tag), onLage);
    case 'edge': {
      const hits = env.lage.edges.filter(
        (e) =>
          e.kind === c.edgeKind &&
          (c.from === undefined || e.from === c.from) &&
          (c.to === undefined || e.to === c.to),
      );
      const seen = hits.filter((e) => env.visible.has(e.from) && env.visible.has(e.to));
      if (seen.length > 0) {
        return { state: 'met', cards: [...new Set(seen.flatMap((e) => [e.from, e.to]))] };
      }
      return env.hiddenOnLage.size > 0 && hits.length > 0 ? unknown : unmet;
    }
    case 'stance': {
      const stance = await stanceFor(env.s, c.card);
      return stance?.position === c.position ? { state: 'met', cards: [c.card] } : unmet;
    }
  }
}

/** A condition on one card (given) or on any card placed on the Lage. */
async function byCard(
  env: Env,
  cardId: string | undefined,
  test: (card: Card) => boolean,
  onLage: ReadonlySet<string>,
): Promise<Outcome> {
  if (cardId !== undefined) {
    const card = env.visible.get(cardId) ?? (await env.s.storage.read(cardId));
    if (!card) return unknown;
    return test(card) ? { state: 'met', cards: [cardId] } : unmet;
  }
  const hits = [...env.visible.values()].filter((card) => onLage.has(card.id) && test(card));
  return hits.length > 0 ? { state: 'met', cards: hits.map((h) => h.id) } : unmet;
}

async function evaluateRule(env: Env, ruleCard: Card, rule: Rule): Promise<RuleResult> {
  const unmetRefs: RuleConditionRef[] = [];
  const unknownRefs: RuleConditionRef[] = [];
  const triggering = new Set<string>();
  let whenMet = true;
  let unlessMet = false;
  let unlessUnknown = false;
  const clauses = [
    ['when', rule.when],
    ['unless', rule.unless ?? []],
  ] as const;
  for (const [clause, conditions] of clauses) {
    for (const [index, condition] of conditions.entries()) {
      const outcome = await evaluateCondition(env, condition);
      if (outcome.state === 'unmet') unmetRefs.push({ clause, index });
      if (outcome.state === 'unknown') unknownRefs.push({ clause, index });
      if (clause === 'when') {
        if (outcome.state !== 'met') whenMet = false;
        else outcome.cards.forEach((id) => triggering.add(id));
      } else if (outcome.state === 'met') unlessMet = true;
      else if (outcome.state === 'unknown') unlessUnknown = true;
    }
  }
  const fired = whenMet && !unlessMet && !unlessUnknown;
  return {
    ruleId: ruleCard.id,
    fired,
    triggeringCardIds: fired ? [...triggering] : [],
    unmet: unmetRefs,
    unknown: unknownRefs,
    rule,
  };
}

export async function evaluateRules(
  s: Services,
  principal: Principal,
  lageId: string,
): Promise<RuleEvaluation> {
  const target = targetOf(principal);
  const lageCard = await readLage(s, lageId);
  if (!lageCard) throw new HttpError(404, 'unknown Lage');
  if (target !== 'screen' && (await s.gate.decide(lageCard, target)).decision !== 'allow') {
    throw new HttpError(404, 'unknown Lage');
  }

  // The cards on the Lage that this target may see.
  const placed: Card[] = [];
  for (const p of lageCard.lage.cards) {
    const card = await s.storage.read(p.id);
    if (card) placed.push(card);
  }
  const { allowed } = await s.gate.filter(placed, target);
  const visible = new Map(allowed.map((c) => [c.id, c] as const));
  const hiddenOnLage = new Set(placed.filter((c) => !visible.has(c.id)).map((c) => c.id));
  const env: Env = { lage: lageCard.lage, target, visible, hiddenOnLage, s };

  const ruleCards = await collect(
    (cursor) => s.storage.search({ type: 'rule', limit: 200, ...(cursor ? { cursor } : {}) }),
    1000,
  );
  const results: RuleResult[] = [];
  let withheld = 0;
  for (const ruleCard of ruleCards) {
    const rule = ruleCard.rule;
    if (!rule) continue;
    if (target === 'screen') {
      // The user's own rules on the user's own screen: shown unless a rule denies them there.
      if ((await s.gate.decide(ruleCard, 'screen')).decision !== 'allow') continue;
      results.push(await evaluateRule(env, ruleCard, rule));
      continue;
    }
    const conditions = [...rule.when, ...(rule.unless ?? [])];
    let hidden = (await s.gate.decide(ruleCard, target)).decision !== 'allow';
    for (const c of conditions) {
      if (c.kind === 'stance') hidden = true;
      // An edge condition that matches an edge touching a card the target may not see would
      // answer from the visible edges only: the rule is withheld, not evaluated (ADR-0013).
      if (c.kind === 'edge' && edgeTouchesHidden(env, c)) hidden = true;
      for (const id of referencedCards(c)) {
        if (visible.has(id)) continue;
        const card = await s.storage.read(id);
        // A missing card is evaluable as unknown; a card the target may not see is not.
        if (card && (await s.gate.decide(card, target)).decision !== 'allow') hidden = true;
      }
    }
    if (hidden) {
      withheld++;
      continue;
    }
    results.push(await evaluateRule(env, ruleCard, rule));
  }
  return {
    lageId,
    lageVersion: lageCard.lage.version,
    target,
    evaluatedAt: s.now().toISOString(),
    results,
    withheld: target === 'screen' ? 0 : withheld,
  };
}
