// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Ask one model about this Lage (ADR-0015, ADR-0031). Ollama runs on this device. A cloud
// model and the decision service return a transfer first: nothing is sent until the human
// confirms that one transfer. The answer is a pending comment, not a card (ADR-0011).

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DisclosureTransfer, ModelAskRequest, Proposal } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { canonicalJson } from '../canonicalJson.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
  lageId: string;
  disabled?: boolean;
}

const ENGINES: { id: ModelAskRequest['engine']; label: string }[] = [
  { id: 'ollama', label: 'Ollama on this device' },
  { id: 'cloud-chat', label: 'Cloud model' },
  { id: 'decision-stub', label: 'Decision service' },
];

function commentOf(proposal: Proposal): string | null {
  return proposal.kind === 'comment' ? proposal.payload.text : null;
}

export function ModelAskPanel({ client, lageId, disabled }: Props) {
  const [engine, setEngine] = useState<ModelAskRequest['engine']>('ollama');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [preview, setPreview] = useState<DisclosureTransfer | null>(null);

  async function ask(send?: { transferId: string; confirmationToken: string }) {
    const asked = question.trim();
    if (asked === '') {
      setError('Write a question first.');
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await client.model_ask(lageId, { engine, question: asked, ...send });
      if (res.status === 'proposed' && res.proposal) {
        setPreview(null);
        setAnswer(commentOf(res.proposal));
        setNote(`Pending comment by ${res.proposal.author}. Accept it to keep it.`);
      } else if (res.status === 'confirmation_required' && res.transfer) {
        setAnswer(null);
        setPreview(res.transfer);
      } else if (res.status === 'nothing_cleared') {
        setPreview(null);
        setAnswer(null);
        setNote('No card on this board is cleared for that model.');
      } else {
        setError('The model answer could not be read.');
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
      await ask({ transferId: transfer.transferId, confirmationToken: confirmation.token });
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask();
  }

  const locked = busy || disabled;

  return (
    <section className="wb-panel" aria-labelledby="model-h" data-testid="model-panel">
      <h2 id="model-h">Ask a model</h2>
      <p className="wb-muted">
        Ollama runs on this device. A cloud model and the decision service send nothing until you
        confirm that one transfer. The answer is a pending comment, not a card.
      </p>
      <form onSubmit={onSubmit} data-testid="model-form">
        <div className="wb-field">
          <label htmlFor="model-engine">Model</label>
          <select
            id="model-engine"
            data-testid="model-engine"
            value={engine}
            disabled={locked}
            onChange={(e) => {
              setEngine(e.target.value as ModelAskRequest['engine']);
              setPreview(null);
              setNote(null);
            }}
          >
            {ENGINES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="wb-field">
          <label htmlFor="model-question">Question</label>
          <textarea
            id="model-question"
            data-testid="model-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={locked}
            required
            rows={3}
          />
        </div>
        <button type="submit" className="wb-primary" data-testid="model-ask" disabled={locked}>
          Ask
        </button>
      </form>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="wb-error" data-testid="model-error">
            {error}
          </p>
        )}
        {note && (
          <p className="wb-muted" data-testid="model-note">
            {note}
          </p>
        )}
        {answer && <p data-testid="model-proposal">{answer}</p>}
      </div>
      {preview && (
        <div data-testid="model-preview">
          <p className="wb-warning" role="note">
            This model runs outside this device. This is the complete envelope. Nothing else is
            sent, and only after you confirm this one transfer.
          </p>
          <dl className="wb-envelope">
            <dt>Connector</dt>
            <dd data-testid="model-envelope-connector">{preview.preview.connectorId}</dd>
            <dt>Request</dt>
            <dd>
              <pre className="wb-json" tabIndex={0} data-testid="model-envelope-request">
                {canonicalJson(preview.preview.request)}
              </pre>
            </dd>
          </dl>
          <ul className="wb-list" aria-label="Cards that would be sent">
            {preview.preview.objects.map((card) => (
              <li key={card.id} data-testid={`model-send-${card.id}`}>
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
              data-testid="model-confirm"
              disabled={locked}
              onClick={() => void confirm(preview)}
            >
              Confirm this transfer
            </button>
            <button
              type="button"
              data-testid="model-cancel"
              disabled={locked}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
