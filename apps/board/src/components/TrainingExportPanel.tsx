// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Opt-in training export (ADR-0017, ADR-0031). JSONL of decision traces. Nothing leaves
// until the human confirms that one transfer. Cards that did not opt in never appear.

import { useState } from 'react';
import type { DisclosureTransfer } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { canonicalJson } from '../canonicalJson.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
}

export function TrainingExportPanel({ client }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<DisclosureTransfer | null>(null);
  const [jsonl, setJsonl] = useState<string | null>(null);

  async function run(send?: { transferId: string; confirmationToken: string }) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await client.training_export(send ?? {});
      if (res.status === 'exported' && res.jsonl) {
        setPreview(null);
        setJsonl(res.jsonl);
        setNote(`${res.traces} decision ${res.traces === 1 ? 'trace' : 'traces'}.`);
      } else if (res.status === 'confirmation_required' && res.transfer) {
        setJsonl(null);
        setPreview(res.transfer);
      } else if (res.status === 'nothing_to_export') {
        setPreview(null);
        setJsonl(null);
        setNote('No opted-in decision with a known outcome is cleared for a cloud model.');
      } else {
        setError('The export could not be read.');
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(transfer: DisclosureTransfer) {
    setBusy(true);
    setError(null);
    try {
      const confirmation = await client.disclosure_confirm(
        transfer.transferId,
        transfer.payloadHash,
      );
      if (!confirmation.token) throw new Error('The service issued no confirmation token.');
      await run({ transferId: transfer.transferId, confirmationToken: confirmation.token });
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <section className="wb-panel" aria-labelledby="export-h" data-testid="export-panel">
      <h2 id="export-h">Training export</h2>
      <p className="wb-muted">
        A JSONL file of decision traces. Only cards with training on. Nothing leaves this device
        until you confirm that one transfer.
      </p>
      <button
        type="button"
        className="wb-primary"
        data-testid="export-preview"
        disabled={busy}
        onClick={() => void run()}
      >
        Preview export
      </button>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="wb-error" data-testid="export-error">
            {error}
          </p>
        )}
        {note && (
          <p className="wb-muted" data-testid="export-note">
            {note}
          </p>
        )}
      </div>
      {preview && (
        <div data-testid="export-preview-envelope">
          <p className="wb-warning" role="note">
            This file would leave the device. This is the complete envelope. Nothing else is sent,
            and only after you confirm this one transfer.
          </p>
          <dl className="wb-envelope">
            <dt>Connector</dt>
            <dd data-testid="export-envelope-connector">{preview.preview.connectorId}</dd>
          </dl>
          <ul className="wb-list" aria-label="Cards that would be exported">
            {preview.preview.objects.map((card) => (
              <li key={card.id} data-testid={`export-send-${card.id}`}>
                <strong>{card.title}</strong>
                <pre className="wb-json" tabIndex={0} aria-label={`Every field of ${card.title}`}>
                  {canonicalJson(card)}
                </pre>
              </li>
            ))}
          </ul>
          <div className="wb-row">
            <button
              type="button"
              className="wb-primary"
              data-testid="export-confirm"
              disabled={busy}
              onClick={() => void confirm(preview)}
            >
              Confirm this transfer
            </button>
            <button
              type="button"
              data-testid="export-cancel"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {jsonl && (
        <div data-testid="export-file">
          <a
            className="wb-primary"
            data-testid="export-download"
            download="training-export.jsonl"
            href={`data:application/jsonl;charset=utf-8,${encodeURIComponent(jsonl)}`}
          >
            Download JSONL
          </a>
          <pre className="wb-json" tabIndex={0} data-testid="export-jsonl">
            {jsonl}
          </pre>
        </div>
      )}
    </section>
  );
}
