// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The what-if layer (ADR-0050). Assumptions typed here are not cards. Saving replaces the
// in-memory layer. Attaching them to a decision happens in the decision panel.

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
  lageId: string;
  disabled?: boolean;
}

/** One assumption per line. A blank line is skipped. The service drops a repeated line. */
export function ScenarioPanel({ client, lageId, disabled }: Props) {
  const [lines, setLines] = useState('');
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    client
      .scenario_get(lageId)
      .then((layer) => {
        if (cancel) return;
        setAssumptions(layer.assumptions.map((item) => item.statement));
        setLines(layer.assumptions.map((item) => item.statement).join('\n'));
      })
      .catch((e: unknown) => {
        if (!cancel) setError(describeError(e));
      });
    return () => {
      cancel = true;
    };
  }, [client, lageId]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    const statements = lines
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    setBusy(true);
    setError(null);
    try {
      const layer = await client.scenario_replace(lageId, {
        assumptions: statements.map((statement) => ({ statement })),
      });
      setAssumptions(layer.assumptions.map((item) => item.statement));
      setLines(layer.assumptions.map((item) => item.statement).join('\n'));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wb-panel" aria-labelledby="scenario-h" data-testid="scenario-panel">
      <h2 id="scenario-h">What-if</h2>
      <p className="wb-muted" data-testid="scenario-note">
        These assumptions are not cards. A restart clears them. Attach them to a decision to keep
        them on this device.
      </p>
      <form onSubmit={onSave} data-testid="scenario-form">
        <div className="wb-field">
          <label htmlFor="scenario-lines">Assumptions, one per line</label>
          <textarea
            id="scenario-lines"
            data-testid="scenario-lines"
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            disabled={busy || disabled}
            rows={4}
          />
        </div>
        <button
          type="submit"
          className="wb-primary"
          data-testid="scenario-save"
          disabled={busy || disabled}
        >
          Save what-if
        </button>
      </form>
      {assumptions.length === 0 ? (
        <p data-testid="scenario-empty">No what-if assumptions.</p>
      ) : (
        <ul data-testid="scenario-list">
          {assumptions.map((statement, index) => (
            <li key={statement} data-testid={`scenario-assumption-${index}`}>
              {statement}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="wb-error" data-testid="scenario-error">
          {error}
        </p>
      )}
    </section>
  );
}
