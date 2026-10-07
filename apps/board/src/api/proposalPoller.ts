// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Polls proposal_list with the change cursor every 2 seconds while a Lage is open (ADR-0032).
// The first poll has no cursor and loads the proposals of the Lage; each answer's nextCursor
// becomes the next changedSince, so no proposal is missed or repeated. A full page is followed
// at once, because more changes may be waiting. In M2 server-sent events replace this.

import type { Proposal } from '@worldbuilder/core';
import type { BoardClient } from './client.js';

export const POLL_INTERVAL_MS = 2000;
export const MAX_BACKOFF_MS = 30_000;
const PAGE = 200;

export interface PollerOptions {
  client: Pick<BoardClient, 'proposal_list'>;
  /** Only the proposals of this Lage; without it every proposal (the global view). */
  lageId?: string;
  intervalMs?: number;
  /** Called with every proposal that was created or changed since the last poll. */
  onChanges(changed: Proposal[]): void;
  /** Called after every successful request, also when nothing changed. */
  onSuccess?(): void;
  onError?(error: unknown): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** One poll now; resolves when it and any follow-up pages are done. */
  pollOnce(): Promise<void>;
}

/** Delay before the next poll: the interval, doubled per failure in a row, at most 30 s. */
export function nextDelay(intervalMs: number, failures: number): number {
  return Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** failures);
}

export function createProposalPoller(options: PollerOptions): Poller {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let cursor: string | undefined;
  let handle: unknown;
  let running = false;
  // Every stop starts a new generation: an answer that arrives after a stop is dropped, so no
  // callback runs once the poller was stopped (for example by a closed board).
  let generation = 0;
  let failures = 0;
  let inFlight: Promise<void> | undefined;

  function pollOnce(): Promise<void> {
    if (inFlight) return inFlight;
    const mine = generation;
    const current = (): boolean => mine === generation;
    const run = (async () => {
      try {
        for (;;) {
          const page = await options.client.proposal_list({
            ...(options.lageId ? { lageId: options.lageId } : {}),
            limit: PAGE,
            ...(cursor ? { changedSince: cursor } : {}),
          });
          if (!current()) return;
          if (page.nextCursor) cursor = page.nextCursor;
          failures = 0;
          options.onSuccess?.();
          if (page.proposals.length > 0) options.onChanges(page.proposals);
          if (page.proposals.length < PAGE) return;
        }
      } catch (e) {
        if (!current()) return;
        failures++;
        options.onError?.(e);
      } finally {
        if (current()) inFlight = undefined;
      }
    })();
    inFlight = run;
    return run;
  }

  function schedule(mine: number): void {
    if (mine !== generation || !running) return;
    handle = setTimer(
      () => {
        void pollOnce().finally(() => schedule(mine));
      },
      nextDelay(interval, failures),
    );
  }

  return {
    start() {
      if (running) return;
      running = true;
      const mine = generation;
      void pollOnce().finally(() => schedule(mine));
    },
    stop() {
      running = false;
      generation++;
      inFlight = undefined;
      if (handle !== undefined) clearTimer(handle);
      handle = undefined;
    },
    pollOnce,
  };
}

/** Merges changed proposals into the known set by id, newest state wins. */
export function mergeProposals(
  known: readonly Proposal[],
  changed: readonly Proposal[],
): Proposal[] {
  const byId = new Map(known.map((p) => [p.id, p] as const));
  for (const p of changed) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
