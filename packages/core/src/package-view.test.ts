// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import type { Card, EdgeKind } from './generated/contracts.js';
import { computeContentHash } from './content-hash.js';
import { cardsForPackage } from './package-view.js';

const HIDDEN = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const KEPT = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const RULE = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const DECISION = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const BOARD = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    format: 2,
    type: 'claim',
    title: id,
    author: 'human',
    contentHash: 'sha256:' + 'ab'.repeat(32),
    ...extra,
  } as Card;
}

function edge(target: string, kind: EdgeKind = 'cites'): NonNullable<Card['edges']>[number] {
  return { target, kind, by: 'human' };
}

function lage(ids: string[], links: { from: string; to: string }[] = []) {
  return {
    question: 'Which claim holds?',
    options: ['Keep it'],
    cards: ids.map((id, index) => ({ id, x: index, y: 0 })),
    seats: [{ name: 'Analyst', kind: 'human' as const }],
    edges: links.map((link) => ({ ...link, kind: 'supports' as const, by: 'human' as const })),
    version: 1,
    updatedAt: '2026-10-13T00:00:00Z',
  };
}

function sections(cardsUsed: string[]): NonNullable<Card['sections']> {
  return {
    situation: 's',
    trigger: 't',
    conditions: 'c',
    facts: 'f',
    priorities: 'p',
    action: 'a',
    alternatives: 'l',
    exclusions: 'e',
    rationale: 'r',
    cardsUsed,
    outcome: 'open',
  };
}

describe('cardsForPackage', () => {
  it('returns the stored cards for the screen', () => {
    const stored = [card(KEPT, { edges: [edge(HIDDEN)], body: `see ${HIDDEN}` })];
    const view = cardsForPackage(stored, 'screen');
    expect(view).toEqual({ cards: stored, withheld: 0 });
    expect(view.cards[0]).toBe(stored[0]);
  });

  it('keeps only relations whose ends are in the package and drops the old rendering', () => {
    const board = card(BOARD, {
      type: 'lage',
      body: `placed ${HIDDEN}`,
      lage: lage(
        [KEPT, HIDDEN],
        [
          { from: KEPT, to: HIDDEN },
          { from: KEPT, to: KEPT },
        ],
      ),
    });
    const claim = card(KEPT, { edges: [edge(HIDDEN), edge(KEPT)] });
    const decision = card(DECISION, {
      type: 'decision',
      body: `used ${HIDDEN}`,
      sections: sections([KEPT, HIDDEN]),
    });
    const view = cardsForPackage([board, claim, decision], 'local_model');
    expect(view.withheld).toBe(0);
    expect(JSON.stringify(view.cards)).not.toContain(HIDDEN);
    expect(view.cards.map((item) => item.id)).toEqual([BOARD, KEPT, DECISION]);
    expect(view.cards[0]?.body).toBeUndefined();
    expect(view.cards[0]?.lage?.cards.map((placement) => placement.id)).toEqual([KEPT]);
    expect(view.cards[0]?.lage?.edges).toEqual([
      { from: KEPT, to: KEPT, kind: 'supports', by: 'human' },
    ]);
    expect(view.cards[0]?.contentHash).toBe(computeContentHash(view.cards[0]!));
    expect(view.cards[1]?.edges).toEqual([edge(KEPT)]);
    expect(view.cards[1]?.contentHash).toBe(claim.contentHash);
    expect(view.cards[2]?.body).toBeUndefined();
    expect(view.cards[2]?.sections?.cardsUsed).toEqual([KEPT]);
    expect(view.cards[2]?.contentHash).toBe(computeContentHash(view.cards[2]!));
  });

  it('leaves a card that already names only visible cards as the same object', () => {
    const claim = card(KEPT, { edges: [edge(KEPT)] });
    const board = card(BOARD, {
      type: 'lage',
      lage: lage([KEPT], [{ from: KEPT, to: KEPT }]),
    });
    const decision = card(DECISION, { type: 'decision', sections: sections([KEPT]) });
    const stays = card(RULE, {
      type: 'rule',
      rule: {
        when: [{ kind: 'card_on_lage', card: KEPT }],
        unless: [{ kind: 'card_field', field: 'layer', equals: 'evidenced' }],
        then: 'Keep',
      },
    });
    const view = cardsForPackage([claim, board, decision, stays], 'demo');
    expect(view.withheld).toBe(0);
    expect(view.cards[0]).toBe(claim);
    expect(view.cards[1]).toBe(board);
    expect(view.cards[2]).toBe(decision);
    expect(view.cards[3]).toBe(stays);
  });

  it('drops a decision that would name nobody, then drops the edge that named that decision', () => {
    const decision = card(DECISION, { type: 'decision', sections: sections([HIDDEN]) });
    const claim = card(KEPT, { edges: [edge(DECISION, 'based_on')] });
    const citesRule = card(RULE, {
      type: 'rule',
      rule: {
        when: [{ kind: 'card_field', card: DECISION, field: 'type', equals: 'decision' }],
        then: 'Wait',
      },
    });
    const view = cardsForPackage([decision, claim, citesRule], 'local_model');
    const rest = { ...claim };
    delete rest.edges;
    expect(view.withheld).toBe(2);
    expect(view.cards).toEqual([rest]);
    expect(JSON.stringify(view.cards)).not.toContain(DECISION);
    expect(JSON.stringify(view.cards)).not.toContain(RULE);
  });

  it('withholds a stance rule even when the card it names stays in the package', () => {
    const kept = card(KEPT);
    const stanceRule = card(RULE, {
      type: 'rule',
      body: 'depends on my stance',
      rule: {
        when: [{ kind: 'stance', card: KEPT, position: 'believed' }],
        then: 'Wait',
      },
    });
    const view = cardsForPackage([kept, stanceRule], 'cloud_model');
    expect(view.withheld).toBe(1);
    expect(view.cards).toEqual([kept]);
    expect(view.cards[0]).toBe(kept);
    expect(JSON.stringify(view.cards)).not.toContain('stance');
    const screen = cardsForPackage([kept, stanceRule], 'screen');
    expect(screen.cards[1]).toBe(stanceRule);
  });

  it('withholds a rule that names a card the package does not contain', () => {
    const kept = card(KEPT);
    const onLage = card('01ARZ3NDEKTSV4RRFFQ69G5FB1', {
      type: 'rule',
      rule: { when: [{ kind: 'card_on_lage', card: HIDDEN }], then: 'a' },
    });
    const field = card('01ARZ3NDEKTSV4RRFFQ69G5FB2', {
      type: 'rule',
      rule: {
        when: [{ kind: 'card_field', card: HIDDEN, field: 'type', equals: 'claim' }],
        then: 'b',
      },
    });
    const tagged = card('01ARZ3NDEKTSV4RRFFQ69G5FB3', {
      type: 'rule',
      rule: { when: [{ kind: 'tag', card: HIDDEN, tag: 'war' }], then: 'c' },
    });
    const edgeRule = card('01ARZ3NDEKTSV4RRFFQ69G5FB4', {
      type: 'rule',
      rule: {
        when: [{ kind: 'edge', edgeKind: 'supports', to: HIDDEN }],
        unless: [{ kind: 'tag', tag: 'open' }],
        then: 'd',
      },
    });
    const view = cardsForPackage([kept, onLage, field, tagged, edgeRule], 'share');
    expect(view.withheld).toBe(4);
    expect(view.cards).toEqual([kept]);
    expect(JSON.stringify(view.cards)).not.toContain(HIDDEN);
  });
});
