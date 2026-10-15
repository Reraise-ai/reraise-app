// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Proposals while a screen is open (ADR-0032). The live channel replaces the 2 s poll. The
// poll stays as the first load and as the catch-up when the stream drops.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Proposal } from '@worldbuilder/core';
import type { BoardClient } from './api/client.js';
import { openLiveChannel } from './api/liveChannel.js';
import { createProposalPoller, mergeProposals } from './api/proposalPoller.js';
import { describeError } from './errors.js';

export function useLiveFeed(options: {
  client: BoardClient;
  /** When set, a move for another Lage does not reload this board. Proposals still arrive. */
  lageId?: string;
  pollIntervalMs?: number;
  /** The board changed: a move, or an accepted proposal. */
  onBoardChange?: () => void;
}): { proposals: Proposal[]; pollError: string | null; note(proposal: Proposal): void } {
  const { client, lageId, pollIntervalMs, onBoardChange } = options;
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const note = useCallback((proposal: Proposal) => {
    setProposals((known) => mergeProposals(known, [proposal]));
  }, []);
  // A new load callback must not drop the stream and open it again.
  const onBoardChangeRef = useRef(onBoardChange);
  onBoardChangeRef.current = onBoardChange;

  useEffect(() => {
    let alive = true;
    const poller = createProposalPoller({
      client,
      ...(pollIntervalMs !== undefined ? { intervalMs: pollIntervalMs } : {}),
      onSuccess: () => alive && setPollError(null),
      onChanges: (changed) => {
        if (!alive) return;
        setProposals((known) => mergeProposals(known, changed));
        if (changed.some((p) => p.status === 'accepted')) onBoardChangeRef.current?.();
      },
      onError: (e) => alive && setPollError(describeError(e)),
    });
    poller.start();
    const channel = openLiveChannel({
      open: (signal) => client.openEvents(undefined, signal),
      onUp: () => poller.pause(),
      onDown: () => poller.resume(),
      onNotice: (notice) => {
        if (!alive) return;
        if (notice.kind === 'move') {
          if (lageId !== undefined && notice.lageId !== undefined && notice.lageId !== lageId) {
            return;
          }
          onBoardChangeRef.current?.();
        }
        void poller.pollOnce();
      },
    });
    return () => {
      alive = false;
      channel.close();
      poller.stop();
    };
  }, [client, lageId, pollIntervalMs]);

  return { proposals, pollError, note };
}
