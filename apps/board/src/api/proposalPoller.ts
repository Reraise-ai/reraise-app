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
const PAGE = 200;

export interface PollerOptions {
  client: Pick<BoardClient, 'proposal_list'>;
  lageId: string;
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

export function createProposalPoller(options: PollerOptions): Poller {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let cursor: string | undefined;
  let handle: unknown;
  let running = false;
  let stopped = true;
  let inFlight: Promise<void> | undefined;

  async function pollOnce(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        for (;;) {
          const page = await options.client.proposal_list({
            lageId: options.lageId,
            limit: PAGE,
            ...(cursor ? { changedSince: cursor } : {}),
          });
          if (page.nextCursor) cursor = page.nextCursor;
          options.onSuccess?.();
          if (page.proposals.length > 0) options.onChanges(page.proposals);
          if (page.proposals.length < PAGE) return;
        }
      } catch (e) {
        options.onError?.(e);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  }

  function schedule(): void {
    if (stopped) return;
    handle = setTimer(() => {
      void pollOnce().finally(schedule);
    }, interval);
  }

  return {
    start() {
      if (running) return;
      running = true;
      stopped = false;
      void pollOnce().finally(schedule);
    },
    stop() {
      stopped = true;
      running = false;
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
