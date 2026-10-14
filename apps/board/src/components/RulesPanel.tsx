// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Which of the user's rules fire on this board (ADR-0013). The text is the rule's own `then`.
// There is no percentage, score or recommendation. A proposed card never appears here: the
// service evaluates accepted cards only.

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Card, RuleDraft, RuleEvaluation } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
  lageId: string;
  /** Re-read the rules when the board is saved. */
  lageVersion: number;
  /** World of this board, stored on the new rule when the board has one. */
  worldId?: string;
  cards: Map<string, Card>;
  onFocusCard(id: string): void;
}

/** The rules of this board, fired or not, with the cards that triggered them. */
export function RulesPanel({ client, lageId, lageVersion, worldId, cards, onFocusCard }: Props) {
  const [evaluation, setEvaluation] = useState<RuleEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [title, setTitle] = useState('');
  const [action, setAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ card: Card; action: string } | null>(null);
  const placed = [...cards.values()].filter((c): c is Card & { id: string } => Boolean(c.id));
  const [whenId, setWhenId] = useState(placed[0]?.id ?? '');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    client.rules_evaluate({ lageId }).then(
      (next) => {
        if (!cancelled) setEvaluation(next);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, lageId, lageVersion, revision]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!whenId) {
      setError('Place a card before writing a rule.');
      return;
    }
    const draft: RuleDraft = {
      title: title.trim(),
      ...(worldId ? { worlds: [worldId] } : {}),
      rule: { when: [{ kind: 'card_on_lage', card: whenId }], then: action.trim() },
    };
    setBusy(true);
    setError(null);
    try {
      await client.rule_create(draft);
      setTitle('');
      setAction('');
      setRevision((n) => n + 1);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function startEdit(ruleId: string) {
    setBusy(true);
    setError(null);
    try {
      const card = await client.card_get(ruleId);
      setEditing({ card, action: card.rule?.then ?? '' });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing?.card.id || !editing.card.rule) return;
    setBusy(true);
    setError(null);
    try {
      await client.rule_save(editing.card.id, {
        ...editing.card,
        rule: { ...editing.card.rule, then: editing.action.trim() },
      });
      setEditing(null);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wb-panel" aria-labelledby="rules-h" data-testid="rules-panel">
      <h2 id="rules-h">Rules</h2>
      {/* shortcut: the form authors only a card-on-board condition, widen it when the board needs another condition kind */}
      <form onSubmit={onCreate} data-testid="rule-create-form">
        <fieldset>
          <legend>New rule</legend>
          <div className="wb-field">
            <label htmlFor="rule-title">Title</label>
            <input
              id="rule-title"
              data-testid="rule-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="wb-field">
            <label htmlFor="rule-when">When this card is on the board</label>
            {placed.length === 0 ? (
              <p>Place a card before writing a rule.</p>
            ) : (
              <select
                id="rule-when"
                data-testid="rule-when"
                value={whenId}
                onChange={(e) => setWhenId(e.target.value)}
              >
                {placed.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="wb-field">
            <label htmlFor="rule-then">Action</label>
            <input
              id="rule-then"
              data-testid="rule-then"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="wb-primary"
            data-testid="rule-create-submit"
            disabled={busy || placed.length === 0}
          >
            Save rule
          </button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="wb-error" data-testid="rules-error">
          {error}
        </p>
      )}
      {evaluation && evaluation.results.length === 0 && <p data-testid="rules-empty">No rules.</p>}
      {evaluation && evaluation.results.length > 0 && (
        <ul className="wb-list">
          {evaluation.results.map((result) => (
            <li
              key={result.ruleId}
              data-testid={`rules-row-${result.ruleId}`}
              data-fired={String(result.fired)}
            >
              <p data-testid={`rules-fired-${result.ruleId}`}>
                {result.fired ? 'Fired' : 'Not fired'}
              </p>
              {result.rule?.then && (
                <p data-testid={`rules-then-${result.ruleId}`}>{result.rule.then}</p>
              )}
              {result.triggeringCardIds.length > 0 && (
                <ul>
                  {result.triggeringCardIds.map((cardId) => (
                    <li key={cardId}>
                      <button
                        type="button"
                        className="wb-link"
                        data-testid={`rules-trigger-${result.ruleId}-${cardId}`}
                        onClick={() => onFocusCard(cardId)}
                      >
                        {cards.get(cardId)?.title ?? cardId}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {result.unmet.length > 0 && (
                <p data-testid={`rules-unmet-${result.ruleId}`}>Condition not met</p>
              )}
              {result.unknown.length > 0 && (
                <p data-testid={`rules-unknown-${result.ruleId}`}>Condition unknown</p>
              )}
              {editing?.card.id === result.ruleId ? (
                <form onSubmit={onEdit} data-testid={`rule-edit-form-${result.ruleId}`}>
                  <div className="wb-field">
                    <label htmlFor={`rule-edit-${result.ruleId}`}>Action</label>
                    <input
                      id={`rule-edit-${result.ruleId}`}
                      data-testid="rule-edit-then"
                      value={editing.action}
                      onChange={(e) => setEditing({ ...editing, action: e.target.value })}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="wb-primary"
                    data-testid="rule-edit-submit"
                    disabled={busy}
                  >
                    Save action
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="wb-link"
                  data-testid={`rules-change-${result.ruleId}`}
                  onClick={() => void startEdit(result.ruleId)}
                  disabled={busy}
                >
                  Change
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
