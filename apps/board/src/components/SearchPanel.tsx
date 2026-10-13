// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Card } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';
import { LAYER_LABEL, isAgentAuthor, layerOf } from './CardNode.js';

interface Props {
  client: BoardClient;
  worldId: string | undefined;
  /** Ids already on the board. */
  placedIds: ReadonlySet<string>;
  disabled?: boolean;
  onPlace(card: Card): void;
}

/** Search the gate-cleared cards (cards_search) and place one on the board. */
export function SearchPanel({ client, worldId, placedIds, disabled, onPlace }: Props) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (q: string) => {
      setBusy(true);
      try {
        const page = await client.cards_search({
          ...(worldId ? { worldId } : {}),
          ...(q ? { text: q } : {}),
          limit: 50,
        });
        setResults(page.cards.filter((c) => c.type !== 'lage'));
        setError(null);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [client, worldId],
  );

  useEffect(() => {
    void run('');
  }, [run]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(text.trim());
  };

  return (
    <section aria-labelledby="search-h" data-testid="search-panel">
      <h2 id="search-h">Cards</h2>
      <form onSubmit={submit} role="search" aria-label="Search cards" className="wb-row">
        <label htmlFor="search-input" className="wb-visually-hidden">
          Search text
        </label>
        <input
          id="search-input"
          data-testid="search-input"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search cards"
        />
        <button type="submit" data-testid="search-submit" disabled={busy}>
          Search
        </button>
      </form>
      {error && (
        <p role="alert" className="wb-error">
          {error}
        </p>
      )}
      {results?.length === 0 && <p className="wb-muted">No card matches.</p>}
      <ul className="wb-list" aria-label="Search results">
        {results?.map((c) => {
          const layer = layerOf(c);
          const placed = !!c.id && placedIds.has(c.id);
          return (
            <li key={c.id} data-testid={`search-result-${c.id}`}>
              <div>{c.title}</div>
              <div className="wb-row">
                <span className="wb-badge" data-testid={`search-type-${c.id}`}>
                  {c.type}
                </span>
                <span className="wb-badge" data-kind={layer}>
                  {layer === 'unclassified' ? 'Unclassified' : LAYER_LABEL[layer]}
                </span>
                {isAgentAuthor(c.author) && (
                  <span className="wb-badge" data-kind="agent">
                    {c.author}
                  </span>
                )}
                <button
                  type="button"
                  data-testid={`search-place-${c.id}`}
                  disabled={placed || disabled}
                  aria-label={
                    placed ? `${c.title} is on the board` : `Place ${c.title} on the board`
                  }
                  onClick={() => onPlace(c)}
                >
                  {placed ? 'On board' : 'Place'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
