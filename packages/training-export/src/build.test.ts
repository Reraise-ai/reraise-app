// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { readFileSync } from 'node:fs';
import { computeContentHash } from '@worldbuilder/core';
import type { Card, Proposal } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { buildTrainingRecord, toJsonl, ulidsIn } from './build.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../schemas/fixtures/valid/training-export-record.json', import.meta.url),
    'utf8',
  ),
).data;

/** The `training-opt-in` and `content-hash` cross-checks of validate:schemas, reused as is. */
const scripts = new URL('../../../scripts/validate-schemas.mjs', import.meta.url).href;
const { crossCheck } = (await import(scripts)) as {
  crossCheck: (name: string, data: unknown) => { check: string; message: string }[];
};

const seal = (c: Record<string, unknown>): Card => {
  const card = { ...c } as unknown as Card;
  return { ...card, contentHash: computeContentHash(card) };
};

const [A0, B0] = fixture.usedCards as Card[];
const A = A0!.id;
const B = B0!.id;
const X = '01M1KM00000000000000000009';
const C = '01M1KM00000000000000000001';
const D = '01M1KM00000000000000000002';
const E = '01M1KM00000000000000000003';
const STORE = 'wb:45aaff12-777f-40e3-a97c-8a592e1ea4f6/';

const base = (id: string, extra: Record<string, unknown>) =>
  seal({ ...A0, id, externalId: id, uri: `${STORE}${id}`, ...extra });

const cards: Card[] = [
  seal({
    ...A0,
    edges: [
      { target: X, kind: 'cites', by: 'human' },
      { target: B, kind: 'supports', by: 'human' },
    ],
  }),
  B0!,
  base(X, { training: false, title: 'Private cost estimate' }),
  base(C, {
    collection: 'actors',
    type: 'organisation',
    title: 'Tanker consortium',
    interests: [
      { text: 'Keep insurance low', source: X },
      { text: 'Deliver on time', source: 'https://example.org/consortium/2026' },
    ],
  }),
  base(D, { title: 'Analysis', body: `Builds on ${X}.` }),
  base(E, { layer: 'said', type: 'claim', source: X, title: 'Claim citing an own card' }),
];

const decision = seal({
  ...fixture.decision,
  sections: {
    ...fixture.decision.sections,
    cardsUsed: [A, B, X, C, D, E],
    outcome: 'Rerouted three tankers; two-week delay, no incidents.',
  },
});

const lage = seal({
  ...fixture.lage,
  lage: {
    ...fixture.lage.lage,
    cards: [...fixture.lage.lage.cards, { id: X, x: 10, y: 10 }],
    edges: [
      { from: A, to: B, kind: 'supports', by: 'human' },
      { from: A, to: X, kind: 'cites', by: 'human' },
    ],
  },
});

const accepted = fixture.brainstorm[0] as Proposal;
const brainstorm = [
  accepted,
  { ...accepted, id: '01M1HDJG00152WRCXVJBW0VRS0', payload: { ...accepted.payload, cardId: X } },
  { ...accepted, id: '01M1HDJG00152WRCXVJBW0VRS1', status: 'pending', decidedBy: undefined },
] as Proposal[];

const input = { decision, cards, lage, brainstorm, exportedAt: '2026-10-06T12:00:00Z' };

describe('buildTrainingRecord (ADR-0017, ADR-0039)', () => {
  const { record } = buildTrainingRecord(input);

  it('exports opted-in cards only and passes the training-opt-in cross-check unchanged', () => {
    expect(record).toBeDefined();
    expect(crossCheck('training-export-record.schema.json', record)).toEqual([]);
    expect(ulidsIn(record)).not.toContain(X);
    expect(JSON.stringify(record)).not.toContain(X);
  });

  it('keeps used cards in decision order, without cards that name a private card', () => {
    expect(record!.usedCards.map((c) => c.id)).toEqual([A, B, C]);
    expect((record!.decision as { sections: { cardsUsed: string[] } }).sections.cardsUsed).toEqual([
      A,
      B,
      C,
    ]);
  });

  it('trims edges and player entries that name cards which did not opt in, and rehashes', () => {
    const a = record!.usedCards[0]!;
    expect(a.edges).toEqual([{ target: B, kind: 'supports', by: 'human' }]);
    const c = record!.usedCards[2]! as Card & { interests: { source: string }[] };
    expect(c.interests.map((e) => e.source)).toEqual(['https://example.org/consortium/2026']);
    expect(c.contentHash).toBe(computeContentHash(c));
  });

  it('exports decision and Lage by structure only, with the Lage reduced to exported cards', () => {
    expect(record!.decision).not.toHaveProperty('body');
    expect(record!.lage).not.toHaveProperty('body');
    const state = (record!.lage as { lage: { cards: { id: string }[]; edges: unknown[] } }).lage;
    expect(state.cards.map((p) => p.id)).toEqual([A, B]);
    expect(state.edges).toHaveLength(1);
  });

  it('keeps only accepted brainstorm proposals that name exported cards', () => {
    expect(record!.brainstorm.map((p) => p.id)).toEqual([accepted.id]);
    expect(record!.outcome).toBe('Rerouted three tankers; two-week delay, no incidents.');
  });

  it('leaves out a Lage that did not opt in', () => {
    const r = buildTrainingRecord({ ...input, lage: seal({ ...lage, training: false }) }).record!;
    expect(r).not.toHaveProperty('lage');
    expect(crossCheck('training-export-record.schema.json', r)).toEqual([]);
  });

  it.each([
    [
      'a decision that did not opt in',
      { decision: seal({ ...decision, training: false }) },
      'not_opted_in',
    ],
    [
      'an open outcome',
      { decision: seal({ ...decision, sections: { ...decision.sections, outcome: ' Open ' } }) },
      'outcome_open',
    ],
    ['no opted-in used card', { cards: [cards[2]!] }, 'no_used_cards'],
    [
      'a decision text naming a private card',
      {
        decision: seal({
          ...decision,
          sections: { ...decision.sections, facts: `See ${X} for the costs.` },
        }),
      },
      'decision_names_private_card',
    ],
  ])('skips %s', (_name, change, reason) => {
    expect(buildTrainingRecord({ ...input, ...change } as typeof input)).toEqual({
      skipped: reason,
    });
  });

  it('writes one JSON line per record', () => {
    const jsonl = toJsonl([record!, record!]);
    expect(jsonl.split('\n')).toHaveLength(3);
    expect(JSON.parse(jsonl.split('\n')[0]!)).toEqual(JSON.parse(JSON.stringify(record)));
  });
});

describe('brainstorm without agent free text (ADR-0039)', () => {
  const at = { status: 'accepted', decidedBy: 'human', decidedAt: '2026-09-16T11:00:00Z' };
  const card = { format: 2, type: 'claim', title: 'MARKER private estimate', release: 'private' };
  const leak = {
    ...accepted,
    id: '01M1HDJG00152WRCXVJBW0VRRA',
    kind: 'create_card',
    payload: { card: { ...card, training: false } },
    rationale: 'MARKER my private reasoning',
    ...at,
  };
  const comment = {
    ...accepted,
    id: '01M1HDJG00152WRCXVJBW0VRRB',
    kind: 'comment',
    payload: { text: 'MARKER the user privately believes the consortium will fold' },
    ...at,
  };
  const outcome = {
    ...accepted,
    id: '01M1HDJG00152WRCXVJBW0VRRC',
    kind: 'record_outcome',
    payload: {
      decisionId: decision.id,
      outcome: 'MARKER outcome text',
      expectedContentHash: decision.contentHash,
    },
    ...at,
  };
  const withReason = { ...accepted, rationale: 'MARKER why I placed it' };

  it('drops comments, proposed outcomes and cards that did not opt in, and strips rationales', () => {
    const { record } = buildTrainingRecord({
      ...input,
      brainstorm: [withReason, leak, comment, outcome] as Proposal[],
    });
    expect(record!.brainstorm.map((p) => p.id)).toEqual([accepted.id]);
    expect(record!.brainstorm[0]).not.toHaveProperty('rationale');
    expect(JSON.stringify(record)).not.toContain('MARKER');
    expect(crossCheck('training-export-record.schema.json', record)).toEqual([]);
  });
});
