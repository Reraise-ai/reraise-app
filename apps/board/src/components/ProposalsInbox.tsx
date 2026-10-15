// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useEffect, useRef, useState } from 'react';
import type { Card, Proposal } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { useLiveFeed } from '../liveFeed.js';
import { ProposalsPanel } from './ProposalsPanel.js';

interface Props {
  client: BoardClient;
  pollIntervalMs?: number;
}

/**
 * All proposals, whatever Lage they name (the poll has no lageId), for the screen without an open
 * board. A proposal that names no Lage can only be decided here.
 */
export function ProposalsInbox({ client, pollIntervalMs }: Props) {
  const { proposals, pollError, note } = useLiveFeed({
    client,
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
  });
  const [titles, setTitles] = useState<Map<string, Card>>(new Map());
  const asked = useRef(new Set<string>());

  // Name the cards a pending proposal points at, so you see what you accept.
  useEffect(() => {
    const wanted = new Set<string>();
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      const pl = p.payload as Record<string, unknown>;
      for (const key of ['cardId', 'from', 'to', 'decisionId']) {
        const v = pl[key];
        if (typeof v === 'string' && !asked.current.has(v)) wanted.add(v);
      }
    }
    if (wanted.size === 0) return;
    wanted.forEach((id) => asked.current.add(id));
    void Promise.all([...wanted].map((id) => client.card_get(id).catch(() => undefined))).then(
      (found) => {
        const cards = found.filter((c): c is Card => !!c?.id);
        if (cards.length > 0)
          setTitles((prev) => new Map([...prev, ...cards.map((c) => [c.id!, c] as const)]));
      },
    );
  }, [proposals, client]);

  async function decide(p: Proposal, decision: 'accept' | 'reject') {
    const updated =
      decision === 'accept'
        ? await client.proposal_accept(p.id)
        : await client.proposal_reject(p.id);
    note(updated);
  }

  return (
    <div data-testid="proposals-inbox">
      <ProposalsPanel
        proposals={proposals}
        titles={titles}
        onDecide={decide}
        pollError={pollError}
      />
    </div>
  );
}
