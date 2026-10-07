// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Card } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { emptyLage } from '../lageModel.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
  worldId: string | undefined;
  onOpen(lageId: string): void;
}

/** The Lagen of the world (cards of type lage) and the form that creates one (lage_create). */
export function LageList({ client, worldId, onOpen }: Props) {
  const [lagen, setLagen] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await client.cards_search({ type: 'lage', limit: 100 });
      setLagen(page.cards);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !question.trim()) return;
    setBusy(true);
    try {
      const opts = options
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean);
      const card = await client.lage_create({
        title: title.trim(),
        ...(worldId ? { worlds: [worldId] } : {}),
        lage: emptyLage(question.trim(), opts),
      });
      setTitle('');
      setQuestion('');
      setOptions('');
      if (card.id) onOpen(card.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wb-page">
      <section aria-labelledby="lage-list-h" data-testid="lage-list">
        <h2 id="lage-list-h">Lagen</h2>
        {lagen === null && !error && <p className="wb-muted">Loading.</p>}
        {lagen?.length === 0 && (
          <p className="wb-muted">No Lage yet. Create the first one below.</p>
        )}
        <ul className="wb-list">
          {lagen?.map((l) => (
            <li key={l.id} data-testid={`lage-item-${l.id}`} className="wb-row">
              <span>{l.title}</span>
              <span className="wb-muted">{l.lage?.question}</span>
              <button
                type="button"
                data-testid={`lage-open-${l.id}`}
                onClick={() => l.id && onOpen(l.id)}
                aria-label={`Open ${l.title}`}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="wb-error" data-testid="lage-list-error">
            {error}
          </p>
        )}
      </section>
      <section aria-labelledby="lage-create-h">
        <h2 id="lage-create-h">New Lage</h2>
        <form onSubmit={create} data-testid="lage-create-form" aria-labelledby="lage-create-h">
          <div className="wb-field">
            <label htmlFor="lage-title">Title</label>
            <input
              id="lage-title"
              data-testid="lage-create-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="wb-field">
            <label htmlFor="lage-question">Question</label>
            <input
              id="lage-question"
              data-testid="lage-create-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
            />
          </div>
          <div className="wb-field">
            <label htmlFor="lage-options">Options (one per line)</label>
            <textarea
              id="lage-options"
              data-testid="lage-create-options"
              rows={3}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="wb-primary"
            data-testid="lage-create-submit"
            disabled={busy}
          >
            Create Lage
          </button>
        </form>
      </section>
    </main>
  );
}
