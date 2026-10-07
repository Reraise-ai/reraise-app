// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useState } from 'react';
import type { Card, Proposal } from '@worldbuilder/core';
import { summarizeProposal } from '../proposalSummary.js';
import { describeError } from '../errors.js';

interface Props {
  proposals: readonly Proposal[];
  titles: ReadonlyMap<string, Card>;
  /** Accept or reject; the board refreshes afterwards. Rejects with the service's problem. */
  onDecide(proposal: Proposal, decision: 'accept' | 'reject'): Promise<void>;
  pollError?: string | null;
}

/**
 * Proposals of agents (ADR-0011). Nothing here counts until a human accepts it; accept and
 * reject are human-only endpoints, so this panel is the only place that calls them.
 */
export function ProposalsPanel({ proposals, titles, onDecide, pollError }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = proposals.filter((p) => p.status === 'pending');
  const decided = proposals.filter((p) => p.status !== 'pending').slice(0, 5);

  async function decide(p: Proposal, d: 'accept' | 'reject') {
    setBusyId(p.id);
    setError(null);
    try {
      await onDecide(p, d);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusyId(null);
    }
  }

  const item = (p: Proposal) => (
    <li key={p.id} data-testid={`proposal-${p.id}`} data-status={p.status}>
      <div className="wb-row">
        <span className="wb-badge" data-kind="agent" data-testid={`proposal-author-${p.id}`}>
          {p.author}
        </span>
        <span className="wb-badge" data-testid={`proposal-kind-${p.id}`}>
          {p.kind}
        </span>
        {p.status !== 'pending' && <span className="wb-muted">{p.status}</span>}
      </div>
      <div data-testid={`proposal-summary-${p.id}`}>{summarizeProposal(p, titles)}</div>
      {p.rationale && <div className="wb-muted">{p.rationale}</div>}
      {p.status === 'pending' && (
        <div className="wb-row">
          <button
            type="button"
            className="wb-primary"
            data-testid={`proposal-accept-${p.id}`}
            disabled={busyId === p.id}
            onClick={() => void decide(p, 'accept')}
          >
            Accept
          </button>
          <button
            type="button"
            data-testid={`proposal-reject-${p.id}`}
            disabled={busyId === p.id}
            onClick={() => void decide(p, 'reject')}
          >
            Reject
          </button>
        </div>
      )}
    </li>
  );

  return (
    <section aria-labelledby="proposals-h" data-testid="proposals-panel">
      <h2 id="proposals-h">Proposals</h2>
      <p className="wb-muted">Agent moves wait here. They count only after you accept them.</p>
      <div role="status" aria-live="polite" className="wb-muted" data-testid="proposals-count">
        {pending.length} pending
      </div>
      {pollError && (
        <p role="alert" className="wb-error" data-testid="proposals-poll-error">
          Cannot refresh proposals: {pollError}
        </p>
      )}
      {error && (
        <p role="alert" className="wb-error" data-testid="proposals-error">
          {error}
        </p>
      )}
      <ul className="wb-list" aria-label="Pending proposals">
        {pending.map(item)}
      </ul>
      {decided.length > 0 && (
        <>
          <h3>Decided</h3>
          <ul className="wb-list" aria-label="Decided proposals">
            {decided.map(item)}
          </ul>
        </>
      )}
    </section>
  );
}
