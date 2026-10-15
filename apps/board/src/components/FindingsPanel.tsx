// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Findings from connected sources (ADR-0014). The list is references. Pinning adds a
// private card. The source text stays where it is.

import { useCallback, useEffect, useState } from 'react';
import type { Finding, FindingPinRequest } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
  lageId: string;
  disabled?: boolean;
  onPinned?: () => void;
}

const CONNECTORS = ['http-json', 'obsidian', 'documents'] as const;

function pinConnector(id: string): FindingPinRequest['connector'] | undefined {
  return CONNECTORS.find((item) => item === id);
}

export function FindingsPanel({ client, lageId, disabled, onPinned }: Props) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFindings = useCallback(async () => {
    setError(null);
    const list = await client.findings_list();
    setFindings(list.findings);
  }, [client]);

  useEffect(() => {
    let cancel = false;
    loadFindings().catch((e: unknown) => {
      if (!cancel) setError(describeError(e));
    });
    return () => {
      cancel = true;
    };
  }, [loadFindings]);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await loadFindings();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function pin(finding: Finding) {
    const connector = pinConnector(finding.connector);
    if (!connector) {
      setError('This source cannot be pinned.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.finding_pin({ connector, uri: finding.uri, lageId });
      onPinned?.();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const locked = busy || disabled;

  return (
    <section className="wb-panel" aria-labelledby="findings-h" data-testid="findings-panel">
      <h2 id="findings-h">Findings</h2>
      <p className="wb-muted" data-testid="findings-note">
        These are references from connected sources. Pinning adds a card. The source text stays
        where it is.
      </p>
      <button
        type="button"
        data-testid="findings-refresh"
        disabled={locked}
        onClick={() => void refresh()}
      >
        Refresh
      </button>
      {findings !== null && findings.length === 0 && (
        <p data-testid="findings-empty">No findings from connected sources.</p>
      )}
      {findings !== null && findings.length > 0 && (
        <ul data-testid="findings-list">
          {findings.map((finding, index) => (
            <li key={finding.uri}>
              <span data-testid={`finding-title-${index}`}>{finding.title}</span>
              <span className="wb-muted">{finding.source ?? finding.originSystem}</span>
              <button
                type="button"
                data-testid={`finding-pin-${index}`}
                disabled={locked}
                aria-label={`Pin ${finding.title}`}
                onClick={() => void pin(finding)}
              >
                Pin
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="wb-error" data-testid="findings-error">
          {error}
        </p>
      )}
    </section>
  );
}
