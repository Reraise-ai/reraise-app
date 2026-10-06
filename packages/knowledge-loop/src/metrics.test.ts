// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { Card, Proposal } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { checkChain } from './log.js';
import { computeUsageMetrics, hasOutcome, isoWeekOf, isoWeekRange } from './metrics.js';
import type { UsageLedger } from './metrics.js';
import { AGENT, OTHER_AGENT, consult, logOf, taskOf, ulid, writeBack } from './test-helpers.js';
import { validateContract } from './validate.js';

const NOW = new Date('2026-10-07T12:00:00.000Z'); // Wednesday of 2026-W41
const day = (d: number, h = 9) => new Date(Date.UTC(2026, 9, d, h)).toISOString();

describe('ISO weeks in UTC', () => {
  it.each([
    ['2026-10-05T00:00:00Z', '2026-W41'],
    ['2026-10-04T23:59:59Z', '2026-W40'],
    ['2026-01-01T00:00:00Z', '2026-W01'],
    ['2020-12-31T12:00:00Z', '2020-W53'],
    ['2021-01-03T12:00:00Z', '2020-W53'],
    ['2027-01-01T12:00:00Z', '2026-W53'],
  ])('%s is in %s', (date, week) => {
    expect(isoWeekOf(new Date(date))).toBe(week);
  });

  it('gives Monday to Monday, and refuses weeks that do not exist', () => {
    expect(isoWeekRange('2026-W41')).toEqual({
      start: Date.parse('2026-10-05T00:00:00Z'),
      end: Date.parse('2026-10-12T00:00:00Z'),
    });
    expect(new Date(isoWeekRange('2026-W53').start).toISOString()).toBe('2026-12-28T00:00:00.000Z');
    expect(() => isoWeekRange('2025-W53')).toThrow(/no such/);
    expect(() => isoWeekRange('2026-W00')).toThrow(/no such/);
    expect(() => isoWeekRange('2026-41')).toThrow(/not an ISO week/);
  });
});

const proposal = (n: number, p: Record<string, unknown>): Proposal =>
  ({
    id: ulid(700 + n),
    author: AGENT,
    status: 'pending',
    createdAt: day(6),
    ...p,
  }) as unknown as Proposal;

const draft = (type: string) => ({
  card: { format: 2, type, title: 'Synthetic', release: 'private' },
});
const decision = (outcome: string) =>
  ({ id: ulid(800), type: 'decision', sections: { outcome } }) as unknown as Card;

function ledger(): UsageLedger {
  const k1 = consult(1, { taskRef: 'T1', at: day(6) });
  const w1 = writeBack(2, { taskRef: 'T1', at: day(6, 10) });
  const k2 = consult(3, { taskRef: 'T2', at: day(6), cards: [] });
  const k3 = consult(4, { taskRef: 'T3', agent: OTHER_AGENT, at: day(2) }); // previous week
  const entries = checkChain(logOf([k1, w1, k2, k3])).entries;
  return {
    entries,
    tasks: [
      { record: taskOf('T1', k1, w1, { completedAt: day(6, 11) }), valid: true },
      { record: taskOf('T2', k2, undefined, { completedAt: day(6, 11) }), valid: false },
      {
        record: { ...taskOf('T3', k3, undefined, { completedAt: day(2, 11) }), agent: OTHER_AGENT },
        valid: false,
      },
    ],
    proposals: [
      proposal(1, { kind: 'create_card', payload: draft('claim') }),
      proposal(2, { kind: 'create_card', payload: draft(' Decision ') }),
      proposal(3, {
        kind: 'create_card',
        payload: draft('claim'),
        status: 'accepted',
        decidedBy: 'human',
        decidedAt: day(7, 8),
        createdAt: '2026-09-29T09:00:00.000Z',
      }),
      proposal(4, {
        kind: 'create_card',
        payload: draft('claim'),
        status: 'rejected',
        decidedBy: 'human',
        decidedAt: day(6, 12),
      }),
      proposal(5, {
        kind: 'record_outcome',
        payload: {
          decisionId: ulid(800),
          outcome: 'Rerouted',
          expectedContentHash: `sha256:${'a'.repeat(64)}`,
        },
      }),
      proposal(6, { kind: 'comment', payload: { text: 'Synthetic comment' } }),
    ],
    decisions: [decision('open'), decision('Rerouted at extra cost'), decision(' OPEN ')],
    atlas: [
      { generatedAt: day(7, 0), fresh: true },
      { generatedAt: day(6, 0), fresh: false },
    ],
  };
}

describe('computeUsageMetrics (ADR-0041)', () => {
  it('counts per agent in the rolling window and validates against the schema', () => {
    const m = computeUsageMetrics(ledger(), { now: NOW });
    expect(validateContract('usage-metrics.schema.json', m)).toEqual({ ok: true });
    expect(m.window).toEqual({
      kind: 'rolling_7d',
      start: '2026-09-30T12:00:00.000Z',
      end: '2026-10-07T12:00:00.000Z',
    });
    expect(m.agents.map((a) => a.agent)).toEqual([AGENT, OTHER_AGENT]);
    const scout = m.agents[0]!;
    expect(scout).toMatchObject({
      tasks: 2,
      tasksWithReceipts: 1,
      receiptCoverage: 0.5,
      consults: 2,
      consultsNothingFound: 1,
      writeBacks: 1,
      writeBacksNotNeeded: 1,
      cardsProposed: 3, // proposal 3 was created before the window
      decisionsProposed: 1,
      outcomesProposed: 1,
      cardsAccepted: 1,
      cardsRejected: 1,
    });
    expect(m.totals).toMatchObject({ tasks: 3, tasksWithReceipts: 1, consults: 3 });
    expect(m.totals.receiptCoverage).toBeCloseTo(1 / 3);
    expect(m.decisions).toEqual({ total: 3, withOutcome: 1 });
    expect(m.atlas).toEqual({ pages: 2, stalePages: 1, lagHours: 36 });
  });

  it('counts an ISO week and still evaluates the targets over the rolling 7 days', () => {
    const m = computeUsageMetrics(ledger(), { now: NOW, week: '2026-W40' });
    expect(m.window).toMatchObject({ kind: 'iso_week', isoWeek: '2026-W40' });
    expect(m.agents.map((a) => a.agent)).toEqual([AGENT, OTHER_AGENT]);
    expect(m.agents[1]).toMatchObject({ tasks: 1, receiptCoverage: 0, consults: 1 });
    expect(m.agents[0]).toMatchObject({ cardsProposed: 1, tasks: 0, receiptCoverage: null });
    expect(m.targets.find((t) => t.id === 'agent_cards_7d')!.value).toBe(3);
    expect(validateContract('usage-metrics.schema.json', m)).toEqual({ ok: true });
  });

  it('reports each target with the owner defaults and allows overrides', () => {
    const m = computeUsageMetrics(ledger(), { now: NOW });
    expect(m.targets).toEqual([
      {
        id: 'receipt_coverage_7d',
        comparison: 'at_least',
        threshold: 0.8,
        value: 1 / 3,
        met: false,
      },
      { id: 'agent_cards_7d', comparison: 'at_least', threshold: 5, value: 3, met: false },
      { id: 'atlas_lag_hours', comparison: 'at_most', threshold: 24, value: 36, met: false },
      { id: 'decisions_with_outcome', comparison: 'at_least', threshold: 10, value: 1, met: false },
    ]);
    const relaxed = computeUsageMetrics(ledger(), {
      now: NOW,
      targets: {
        receipt_coverage_7d: 0.3,
        agent_cards_7d: 3,
        atlas_lag_hours: 48,
        decisions_with_outcome: 1,
      },
    });
    expect(relaxed.targets.every((t) => t.met)).toBe(true);
  });

  it('never counts missing evidence as success', () => {
    const m = computeUsageMetrics(
      { entries: [], tasks: [], proposals: [], decisions: null, atlas: null },
      { now: NOW, targets: { agent_cards_7d: 0 } },
    );
    expect(m.agents).toEqual([]);
    expect(m.totals.receiptCoverage).toBeNull();
    expect(m.decisions).toBeNull();
    expect(m.atlas).toEqual({ pages: 0, stalePages: 0, lagHours: null });
    expect(m.targets.map((t) => [t.id, t.met])).toEqual([
      ['receipt_coverage_7d', false],
      ['agent_cards_7d', true],
      ['atlas_lag_hours', false],
      ['decisions_with_outcome', false],
    ]);
    expect(validateContract('usage-metrics.schema.json', m)).toEqual({ ok: true });
  });

  it('reports lag 0 while every page is fresh', () => {
    const m = computeUsageMetrics(
      { ...ledger(), atlas: [{ generatedAt: day(1), fresh: true }] },
      { now: NOW },
    );
    expect(m.atlas.lagHours).toBe(0);
    expect(m.targets.find((t) => t.id === 'atlas_lag_hours')!.met).toBe(true);
  });

  it('knows an outcome only when it is not open', () => {
    expect(hasOutcome(decision('open'))).toBe(false);
    expect(hasOutcome(decision('Done'))).toBe(true);
    expect(hasOutcome({ id: ulid(1) } as unknown as Card)).toBe(false);
  });
});
