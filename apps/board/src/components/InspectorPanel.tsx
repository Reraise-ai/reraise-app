// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useEffect, useState, type FormEvent } from 'react';
import type {
  Card,
  Stance,
  StanceInput,
  StancePosition,
  StoredSourceProfile,
} from '@worldbuilder/core';
import {
  cardSourcePass,
  entriesSourcePass,
  seatEntries,
  sourcePassText,
  type SeatField,
} from '@worldbuilder/core/independence';
import { profileSourceOf } from '@worldbuilder/core/source-profile';
import { ApiError, type BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';
import { LAYER_LABEL, isAgentAuthor, layerOf } from './CardNode.js';
import { SourceProfileList } from './SourceProfileList.js';

interface Props {
  client: BoardClient;
  card: Card | undefined;
  cardId: string | null;
  stance: Stance | undefined;
  onSaveStance(cardId: string, input: StanceInput): Promise<void>;
  /** Takes the card off this Lage. The card file stays in the store. */
  onRemove?(): void;
  removeDisabled?: boolean;
  /** Cards on this board. The source pass counts origins among them. */
  boardCards?: readonly Card[];
}

const POSITIONS: StancePosition[] = ['believed', 'rejected', 'undecided'];

const FIELD_LABEL: Record<SeatField, string> = {
  interests: 'Interest',
  capabilities: 'Capability',
  dependencies: 'Dependency',
  moves: 'Move',
};

function isSeat(card: Card): boolean {
  return (
    card.collection === 'actors' ||
    card.type === 'actor' ||
    card.type === 'person' ||
    card.type === 'organisation'
  );
}

/**
 * The selected card in full and the user's own stance on it (stance_save, human-only). The
 * stance is a private overlay for this screen: it is never a layer, never in a count, never sent.
 */
export function InspectorPanel({
  client,
  card,
  cardId,
  stance,
  onSaveStance,
  onRemove,
  removeDisabled,
  boardCards,
}: Props) {
  const [position, setPosition] = useState<StancePosition>('undecided');
  const [weight, setWeight] = useState(2);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  const [profile, setProfile] = useState<StoredSourceProfile | undefined>();
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    setPosition(stance?.position ?? 'undecided');
    setWeight(stance?.weight ?? 2);
    setNote(stance?.note ?? '');
  }, [cardId, stance]);
  useEffect(() => setState('idle'), [cardId]);

  const source = card ? profileSourceOf(card) : undefined;
  useEffect(() => {
    if (!source) {
      setProfile(undefined);
      setProfileError(null);
      return;
    }
    let cancelled = false;
    setProfile(undefined);
    setProfileError(null);
    client.source_profile_get(source).then(
      (stored) => {
        if (!cancelled) setProfile(stored);
      },
      (e: unknown) => {
        if (cancelled || (e instanceof ApiError && e.status === 404)) return;
        setProfileError(describeError(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, source]);

  const scope = boardCards ?? (card ? [card] : []);
  const cardPass = card?.id ? cardSourcePass(scope, card.id) : undefined;
  const entries = card ? seatEntries(card) : [];

  if (!cardId) {
    return (
      <section aria-labelledby="inspector-h" data-testid="inspector-panel">
        <h2 id="inspector-h">Selected card</h2>
        <p className="wb-muted">Select a card on the board to see it and set your own stance.</p>
      </section>
    );
  }
  const layer = layerOf(card);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!cardId) return;
    setState('saving');
    try {
      await onSaveStance(cardId, {
        position,
        weight,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setState('saved');
    } catch (err) {
      setState({ error: (err as Error).message });
    }
  }

  return (
    <section aria-labelledby="inspector-h" data-testid="inspector-panel">
      <h2 id="inspector-h">Selected card</h2>
      <h3 data-testid="inspector-title">{card?.title ?? 'Card not shown on this screen'}</h3>
      <div className="wb-row">
        {card && (
          <span className="wb-badge" data-testid="inspector-type">
            {card.type}
          </span>
        )}
        <span className="wb-badge" data-kind={layer}>
          {layer === 'unclassified' ? 'Unclassified' : LAYER_LABEL[layer]}
        </span>
        {isAgentAuthor(card?.author) && (
          <span className="wb-badge" data-kind="agent">
            {card?.author}
          </span>
        )}
        <span className="wb-muted">{card?.visibility}</span>
      </div>
      {card?.source && <p className="wb-muted">Source: {card.source}</p>}
      {card && <SourceProfileList profile={profile} error={profileError} />}
      {card?.originSystem && (
        <p className="wb-muted" data-testid="inspector-origin">
          System: {card.originSystem}
        </p>
      )}
      {cardPass && (
        <p className="wb-muted" data-testid="card-source-pass">
          {sourcePassText(cardPass)}
        </p>
      )}
      {card && isSeat(card) && (
        <div data-testid="seat-pass">
          <h3>Seat</h3>
          <p className="wb-muted" data-testid="seat-source-pass">
            {sourcePassText(entriesSourcePass(entries, scope))}
          </p>
          {entries.length > 0 && (
            <ul className="wb-list" data-testid="seat-entries">
              {entries.map((entry, index) => (
                <li key={`${entry.field}-${index}`}>
                  {FIELD_LABEL[entry.field]}: {entry.text} ({entry.source})
                </li>
              ))}
            </ul>
          )}
          <h3>Moves</h3>
          <p className="wb-muted" data-testid="moves-source-pass">
            {sourcePassText(entriesSourcePass(card.moves ?? [], scope))}
          </p>
        </div>
      )}
      {card?.body && <p>{card.body}</p>}
      {onRemove && (
        <button
          type="button"
          data-testid="card-remove"
          disabled={removeDisabled}
          onClick={onRemove}
        >
          Remove from board
        </button>
      )}

      {card && (
        <form onSubmit={save} aria-label="Your stance" data-testid="stance-form">
          <h3>Your stance</h3>
          <p className="wb-muted">Private. Shown on this screen only; never exported or sent.</p>
          <div className="wb-field">
            <label htmlFor="stance-position">Position</label>
            <select
              id="stance-position"
              data-testid="stance-position"
              value={position}
              onChange={(e) => setPosition(e.target.value as StancePosition)}
            >
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="wb-field">
            <label htmlFor="stance-weight">Weight: {weight} (1 weak, 3 strong)</label>
            <input
              id="stance-weight"
              data-testid="stance-weight"
              type="range"
              min={1}
              max={3}
              step={1}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            />
          </div>
          <div className="wb-field">
            <label htmlFor="stance-note">Note</label>
            <textarea
              id="stance-note"
              data-testid="stance-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="submit" data-testid="stance-save" disabled={state === 'saving'}>
            Save stance
          </button>
          <span role="status" className="wb-muted" data-testid="stance-status">
            {state === 'saved' && ' Saved.'}
          </span>
          {typeof state === 'object' && (
            <p role="alert" className="wb-error">
              {state.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
