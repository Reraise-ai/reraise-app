// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useCallback, useEffect, useState } from 'react';
import type { UsageMetrics, UsageTarget } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
}

const TARGET_LABELS: Record<string, string> = {
  receipt_coverage_7d: 'Tasks with a knowledge receipt (7 days)',
  agent_cards_7d: 'Accepted agent cards per week',
  atlas_lag_hours: 'Atlas lag in hours',
  decisions_with_outcome: 'Decisions with an outcome',
};

function formatValue(id: string, v: number | null): string {
  if (v === null) return 'no data';
  if (id === 'receipt_coverage_7d') return `${Math.round(v * 100)} %`;
  return String(Math.round(v * 10) / 10);
}

function formatTarget(t: UsageTarget): string {
  const sign = t.comparison === 'at_least' ? 'at least' : 'at most';
  return `${sign} ${formatValue(t.id, t.threshold)}`;
}

/**
 * Knowledge-loop usage metrics (ADR-0041, human-only endpoint). A plain table: every target is
 * shown on its own with its value, there is no score, rank or overall verdict. A target without
 * data is reported as not met.
 */
export function UsagePanel({ client }: Props) {
  const [week, setWeek] = useState('');
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (w: string) => {
      try {
        setMetrics(await client.usage_metrics_get(w || undefined));
        setError(null);
      } catch (e) {
        setError(describeError(e));
      }
    },
    [client],
  );
  useEffect(() => {
    void load(week);
  }, [load, week]);

  return (
    <main className="wb-page" data-testid="usage-panel" aria-labelledby="usage-h">
      <h2 id="usage-h">Usage metrics</h2>
      <p className="wb-muted">
        How the agents use the knowledge store. Agent proposals count only once you accepted them.
      </p>
      <label>
        ISO week (empty for the last 7 days){' '}
        <input
          data-testid="usage-week"
          value={week}
          placeholder="2026-W41"
          pattern="[0-9]{4}-W[0-9]{2}"
          onChange={(e) => setWeek(e.target.value.trim())}
        />
      </label>
      {error && (
        <p role="alert" className="wb-error" data-testid="usage-error">
          {error}
        </p>
      )}
      {!metrics && !error && <p className="wb-muted">Loading the metrics.</p>}
      {metrics && (
        <>
          <table data-testid="usage-targets">
            <caption>Targets, each on its own</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Value</th>
                <th scope="col">Target</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {metrics.targets.map((t) => (
                <tr key={t.id} data-testid={`usage-target-${t.id}`} data-met={String(t.met)}>
                  <th scope="row">{TARGET_LABELS[t.id] ?? t.id}</th>
                  <td data-testid={`usage-value-${t.id}`}>{formatValue(t.id, t.value)}</td>
                  <td>{formatTarget(t)}</td>
                  <td data-testid={`usage-status-${t.id}`}>{t.met ? 'met' : 'not met'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table data-testid="usage-details">
            <caption>Window {metrics.window.isoWeek ?? 'last 7 days'}</caption>
            <tbody>
              <tr>
                <th scope="row">Tasks with a receipt</th>
                <td data-testid="usage-tasks">
                  {metrics.totals.tasksWithReceipts} of {metrics.totals.tasks}
                </td>
              </tr>
              <tr>
                <th scope="row">Agent cards accepted</th>
                <td data-testid="usage-accepted">
                  {metrics.totals.cardsAccepted} (proposed {metrics.totals.cardsProposed})
                </td>
              </tr>
              <tr>
                <th scope="row">Decisions with an outcome</th>
                <td data-testid="usage-decisions">
                  {metrics.decisions
                    ? `${metrics.decisions.withOutcome} of ${metrics.decisions.total}`
                    : 'no store'}
                </td>
              </tr>
              <tr>
                <th scope="row">Atlas lag</th>
                <td data-testid="usage-atlas">
                  {metrics.atlas.lagHours === null
                    ? 'no atlas pages'
                    : `${metrics.atlas.lagHours} h (${metrics.atlas.stalePages} of ${metrics.atlas.pages} pages stale)`}
                </td>
              </tr>
            </tbody>
          </table>
          {metrics.agents.length > 0 && (
            <table data-testid="usage-agents">
              <caption>Per agent</caption>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Tasks</th>
                  <th scope="col">With receipt</th>
                  <th scope="col">Cards proposed</th>
                  <th scope="col">Cards accepted</th>
                </tr>
              </thead>
              <tbody>
                {metrics.agents.map((a) => (
                  <tr key={a.agent} data-testid={`usage-agent-${a.agent}`}>
                    <th scope="row">{a.agent}</th>
                    <td>{a.tasks}</td>
                    <td>{a.tasksWithReceipts}</td>
                    <td>{a.cardsProposed}</td>
                    <td>{a.cardsAccepted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
