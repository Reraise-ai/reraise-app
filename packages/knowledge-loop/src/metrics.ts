// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Usage metrics of the knowledge loop (ADR-0041), derived by one pure function from the ledger:
// receipt log entries, verified task records, proposals, decision cards and atlas pages.
// Weeks are ISO 8601 weeks in UTC; the targets use the rolling 7 days before `now`.

import type {
  AgentUsage,
  Card,
  CreateCardPayload,
  Proposal,
  ReceiptLogEntry,
  TaskRecord,
  UsageCounts,
  UsageMetrics,
  UsageTarget,
} from '@worldbuilder/core';

import { isKnownOutcome } from '@worldbuilder/core';
import { parseTime } from './time.js';
import { assertContract } from './validate.js';

const DAY_MS = 86_400_000;
const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

export interface UsageLedger {
  /** Entries of a receipt log whose chain check passed. */
  readonly entries: readonly ReceiptLogEntry[];
  /** Task records with the verifier's verdict (both receipts valid). */
  readonly tasks: readonly { readonly record: TaskRecord; readonly valid: boolean }[];
  readonly proposals: readonly Proposal[];
  /** Decision cards of the store; `null` when no store was read. */
  readonly decisions: readonly Card[] | null;
  /** Atlas pages with their staleness; `null` when no atlas was read. */
  /**
   * Atlas pages compared with the pages the current cards produce (`compareAtlas`): every
   * expected page and every extra page; a missing page has `generatedAt: null`. `null` when no
   * atlas was read.
   */
  readonly atlas:
    readonly { readonly generatedAt: string | null; readonly fresh: boolean }[] | null;
}

export type TargetId =
  'receipt_coverage_7d' | 'agent_cards_7d' | 'atlas_lag_hours' | 'decisions_with_outcome';

/** The owner's targets (ADR-0041); every value can be overridden per installation. */
export const DEFAULT_TARGETS: Readonly<
  Record<TargetId, { readonly comparison: 'at_least' | 'at_most'; readonly threshold: number }>
> = {
  receipt_coverage_7d: { comparison: 'at_least', threshold: 0.8 },
  agent_cards_7d: { comparison: 'at_least', threshold: 5 },
  atlas_lag_hours: { comparison: 'at_most', threshold: 24 },
  decisions_with_outcome: { comparison: 'at_least', threshold: 10 },
};

export interface UsageMetricsOptions {
  readonly now: Date;
  /** An ISO week `YYYY-Www`; without it the window is the rolling 7 days before `now`. */
  readonly week?: string;
  readonly targets?: Partial<Record<TargetId, number>>;
}

export interface TimeWindow {
  readonly start: number;
  readonly end: number;
}

/** The ISO week (`YYYY-Www`, UTC) that contains `date`. */
export function isoWeekOf(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  // The Thursday of the same week decides the year.
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Start (Monday 00:00 UTC, inclusive) and end (next Monday, exclusive) of an ISO week. */
export function isoWeekRange(week: string): TimeWindow {
  const m = WEEK_PATTERN.exec(week);
  if (!m) throw new Error(`not an ISO week: ${week}`);
  const year = Number(m[1]);
  const n = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS;
  const start = week1Monday + (n - 1) * 7 * DAY_MS;
  if (n < 1 || isoWeekOf(new Date(start)) !== week) throw new Error(`no such ISO week: ${week}`);
  return { start, end: start + 7 * DAY_MS };
}

const inWindow = (iso: string | undefined, w: TimeWindow) => {
  const t = parseTime(iso);
  return t !== undefined && t >= w.start && t < w.end;
};

const COUNT_FIELDS = [
  'tasks',
  'tasksWithReceipts',
  'consults',
  'consultsNothingFound',
  'writeBacks',
  'writeBacksNotNeeded',
  'cardsProposed',
  'decisionsProposed',
  'outcomesProposed',
  'cardsAccepted',
  'cardsRejected',
] as const;

type Counter = Record<(typeof COUNT_FIELDS)[number], number>;

const zero = (): Counter =>
  Object.fromEntries(COUNT_FIELDS.map((f) => [f, 0])) as unknown as Counter;

const withCoverage = (c: Counter): UsageCounts => ({
  ...c,
  receiptCoverage: c.tasks === 0 ? null : c.tasksWithReceipts / c.tasks,
});

/** Counts per agent inside one window (ADR-0041, table "Per agent a and window W"). */
export function countByAgent(ledger: UsageLedger, w: TimeWindow): Map<string, Counter> {
  const agents = new Map<string, Counter>();
  const of = (agent: string) => {
    let c = agents.get(agent);
    if (!c) agents.set(agent, (c = zero()));
    return c;
  };
  for (const { record, valid } of ledger.tasks) {
    if (!inWindow(record.completedAt, w)) continue;
    const c = of(record.agent);
    c.tasks++;
    if (valid) c.tasksWithReceipts++;
  }
  for (const { receipt } of ledger.entries) {
    if (!inWindow(receipt.at, w)) continue;
    const c = of(receipt.agent);
    if (receipt.kind === 'knowledge') {
      c.consults++;
      if (receipt.result === 'nothing_found') c.consultsNothingFound++;
    } else {
      c.writeBacks++;
      if (receipt.result === 'not_needed') c.writeBacksNotNeeded++;
    }
  }
  for (const p of ledger.proposals) {
    if (p.kind === 'create_card') {
      if (inWindow(p.createdAt, w)) {
        const c = of(p.author);
        c.cardsProposed++;
        const card = (p.payload as CreateCardPayload).card as { type?: unknown };
        if (
          String(card.type ?? '')
            .trim()
            .toLowerCase() === 'decision'
        )
          c.decisionsProposed++;
      }
      if (p.status !== 'pending' && inWindow(p.decidedAt, w)) {
        const c = of(p.author);
        if (p.status === 'accepted') c.cardsAccepted++;
        else c.cardsRejected++;
      }
    } else if (p.kind === 'record_outcome' && inWindow(p.createdAt, w)) {
      of(p.author).outcomesProposed++;
    }
  }
  return agents;
}

const sum = (counters: Iterable<Counter>): Counter => {
  const total = zero();
  for (const c of counters) for (const f of COUNT_FIELDS) total[f] += c[f];
  return total;
};

/** Is this decision card's outcome known? The shared rule of `isKnownOutcome` (core). */
export function hasOutcome(card: Card): boolean {
  return isKnownOutcome((card as { sections?: { outcome?: unknown } }).sections?.outcome);
}

/** Compute the usage metrics document (ADR-0041). */
export function computeUsageMetrics(
  ledger: UsageLedger,
  options: UsageMetricsOptions,
): UsageMetrics {
  const now = options.now.getTime();
  const rolling: TimeWindow = { start: now - 7 * DAY_MS, end: now };
  const window = options.week !== undefined ? isoWeekRange(options.week) : rolling;

  const perAgent = countByAgent(ledger, window);
  const agents: AgentUsage[] = [...perAgent.entries()]
    .filter(([, c]) => COUNT_FIELDS.some((f) => c[f] > 0))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([agent, c]) => ({ agent, ...withCoverage(c) }));
  const totals = withCoverage(sum(perAgent.values()));
  const rollingTotals = withCoverage(sum(countByAgent(ledger, rolling).values()));

  const decisions =
    ledger.decisions === null
      ? null
      : {
          total: ledger.decisions.length,
          withOutcome: ledger.decisions.filter(hasOutcome).length,
        };

  const pages = ledger.atlas ?? [];
  const stale = pages.filter((p) => !p.fresh);
  // A stale page without a usable generation time (missing, unparsable or in the future) has
  // no measurable lag: the lag is unknown and the target is not met (ADR-0041).
  const staleTimes = stale.map((p) => parseTime(p.generatedAt));
  const lagHours =
    pages.length === 0 || staleTimes.some((t) => t === undefined || t > now)
      ? null
      : stale.length === 0
        ? 0
        : Math.round((Math.max(...staleTimes.map((t) => now - t!)) / 3_600_000) * 10) / 10;

  const values: Record<TargetId, number | null> = {
    receipt_coverage_7d: rollingTotals.receiptCoverage,
    agent_cards_7d: rollingTotals.cardsAccepted,
    atlas_lag_hours: lagHours,
    decisions_with_outcome: decisions?.withOutcome ?? null,
  };
  const targets: UsageTarget[] = (Object.keys(DEFAULT_TARGETS) as TargetId[]).map((id) => {
    const { comparison } = DEFAULT_TARGETS[id];
    const threshold = options.targets?.[id] ?? DEFAULT_TARGETS[id].threshold;
    const value = values[id];
    const met =
      value !== null && (comparison === 'at_least' ? value >= threshold : value <= threshold);
    return { id, comparison, threshold, value, met };
  });

  const metrics: UsageMetrics = {
    generatedAt: options.now.toISOString(),
    window:
      options.week !== undefined
        ? {
            kind: 'iso_week',
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString(),
            isoWeek: options.week,
          }
        : {
            kind: 'rolling_7d',
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString(),
          },
    agents,
    totals,
    decisions,
    atlas: { pages: pages.length, stalePages: stale.length, lagHours },
    targets,
  };
  assertContract('usage-metrics.schema.json', metrics, 'usage metrics');
  return metrics;
}
