// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '@worldbuilder/core';
import {
  MAX_BACKOFF_MS,
  POLL_INTERVAL_MS,
  createProposalPoller,
  mergeProposals,
  nextDelay,
} from './proposalPoller.js';
import { LAGE_ID, createMockApi } from '../testing/mockApi.js';
import { createClient } from './client.js';
import { BASE, TOKEN } from '../testing/mockApi.js';

const prop = (id: string, over: Partial<Proposal> = {}): Proposal =>
  ({
    id,
    author: 'agent:scout',
    kind: 'comment',
    payload: { text: id },
    status: 'pending',
    createdAt: '2026-10-06T10:00:00.000Z',
    ...over,
  }) as Proposal;

describe('proposal poller (ADR-0032)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls every 2 seconds with the cursor of the last answer', async () => {
    const calls: unknown[] = [];
    let n = 0;
    const poller = createProposalPoller({
      client: {
        proposal_list: async (p) => {
          calls.push(p);
          return { proposals: [], nextCursor: `c${++n}` };
        },
      },
      lageId: 'L',
      onChanges: () => {},
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(POLL_INTERVAL_MS).toBe(2000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual([
      { lageId: 'L', limit: 200 },
      { lageId: 'L', limit: 200, changedSince: 'c1' },
      { lageId: 'L', limit: 200, changedSince: 'c2' },
    ]);
    poller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(3);
  });

  it('delivers each proposal once across polls (none missed, none repeated)', async () => {
    const api = createMockApi();
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: api.fetch });
    const seen: string[] = [];
    const poller = createProposalPoller({
      client,
      lageId: LAGE_ID,
      onChanges: (c) => seen.push(...c.map((p) => p.id)),
    });
    const a = api.addProposal({
      author: 'agent:scout',
      kind: 'comment',
      payload: { lageId: LAGE_ID, text: 'a' },
    });
    await poller.pollOnce();
    await poller.pollOnce();
    const b = api.addProposal({
      author: 'agent:scout',
      kind: 'comment',
      payload: { lageId: LAGE_ID, text: 'b' },
    });
    await poller.pollOnce();
    await poller.pollOnce();
    expect(seen).toEqual([a.id, b.id]);
  });

  it('follows a full page at once', async () => {
    let call = 0;
    const full = Array.from({ length: 200 }, (_, i) => prop(`p${i}`));
    const got: number[] = [];
    const poller = createProposalPoller({
      client: {
        proposal_list: async () => {
          call++;
          return call === 1
            ? { proposals: full, nextCursor: 'x' }
            : { proposals: [prop('last')], nextCursor: 'y' };
        },
      },
      lageId: 'L',
      onChanges: (c) => got.push(c.length),
    });
    await poller.pollOnce();
    expect(got).toEqual([200, 1]);
  });

  it('reports errors, keeps polling, and does not overlap requests', async () => {
    const errors: unknown[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let fail = true;
    const poller = createProposalPoller({
      client: {
        proposal_list: async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 3000));
          inFlight--;
          if (fail) throw new Error('down');
          return { proposals: [] };
        },
      },
      lageId: 'L',
      onChanges: () => {},
      onError: (e) => errors.push(e),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(errors).toHaveLength(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(maxInFlight).toBe(1);
    expect(errors).toHaveLength(1);
    poller.stop();
  });

  it('pause stops the interval and resume polls again', async () => {
    let n = 0;
    const poller = createProposalPoller({
      client: { proposal_list: async () => ({ proposals: [], nextCursor: String(++n) }) },
      lageId: 'L',
      onChanges: () => {},
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(n).toBe(1);
    poller.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(n).toBe(1);
    poller.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(n).toBe(2);
    poller.stop();
  });

  it('start is idempotent', async () => {
    let n = 0;
    const poller = createProposalPoller({
      client: { proposal_list: async () => ({ proposals: [], nextCursor: String(++n) }) },
      lageId: 'L',
      onChanges: () => {},
    });
    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(n).toBe(1);
    poller.stop();
  });
});

describe('poller backoff and stop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('doubles the delay per failure up to 30 s and resets after a success', async () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => nextDelay(2000, n))).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(MAX_BACKOFF_MS).toBe(30_000);
    let fail = true;
    const times: number[] = [];
    const poller = createProposalPoller({
      client: {
        proposal_list: async () => {
          times.push(Date.now());
          if (fail) throw new Error('down');
          return { proposals: [] };
        },
      },
      onChanges: () => {},
    });
    const t0 = Date.now();
    poller.start();
    await vi.advanceTimersByTimeAsync(4000 + 8000 + 16000);
    expect(times.map((t) => t - t0)).toEqual([0, 4000, 12000, 28000]);
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(times.map((t) => t - t0)).toEqual([0, 4000, 12000, 28000, 58000]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(times).toHaveLength(6);
    poller.stop();
  });

  it('runs no callback after stop, even for an answer still in flight', async () => {
    let release!: () => void;
    const seen: string[] = [];
    const poller = createProposalPoller({
      client: {
        proposal_list: () =>
          new Promise((resolve) => {
            release = () => resolve({ proposals: [prop('late')], nextCursor: 'c' });
          }),
      },
      onChanges: (c) => seen.push(...c.map((p) => p.id)),
      onSuccess: () => seen.push('success'),
      onError: () => seen.push('error'),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual([]);
  });

  it('polls without a lageId when none is given (global view)', async () => {
    const calls: unknown[] = [];
    const poller = createProposalPoller({
      client: {
        proposal_list: async (p) => {
          calls.push(p);
          return { proposals: [] };
        },
      },
      onChanges: () => {},
    });
    await poller.pollOnce();
    expect(calls).toEqual([{ limit: 200 }]);
  });
});

describe('mergeProposals', () => {
  it('lets the newest state of a proposal win and lists newest first', () => {
    const a = prop('A', { createdAt: '2026-10-06T10:00:01.000Z' });
    const b = prop('B', { createdAt: '2026-10-06T10:00:02.000Z' });
    const merged = mergeProposals([a, b], [{ ...a, status: 'accepted' }]);
    expect(merged.map((p) => [p.id, p.status])).toEqual([
      ['B', 'pending'],
      ['A', 'accepted'],
    ]);
  });
});
