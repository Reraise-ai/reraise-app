// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Records one decision for the cards on this board and, once the outcome is known, shows the
// experience card the service stored.
// shortcut: the panel shows the decision recorded in this visit, not decisions already in the store. List them when a decision names its Lage.

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Card, DecisionDraft, DecisionSections } from '@worldbuilder/core';
import { cardsSourcePass, sourcePassText } from '@worldbuilder/core/independence';
import { isKnownOutcome } from '@worldbuilder/core/outcome';
import type { BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';

const FIELDS = [
  ['situation', 'Situation'],
  ['trigger', 'Trigger'],
  ['conditions', 'Conditions'],
  ['facts', 'Facts'],
  ['priorities', 'Priorities'],
  ['action', 'Action'],
  ['alternatives', 'Alternatives'],
  ['exclusions', 'Exclusions'],
  ['rationale', 'Rationale'],
] as const;

type Field = (typeof FIELDS)[number][0];

const emptyFields = (): Record<Field, string> => ({
  situation: '',
  trigger: '',
  conditions: '',
  facts: '',
  priorities: '',
  action: '',
  alternatives: '',
  exclusions: '',
  rationale: '',
});

interface Props {
  client: BoardClient;
  cards: Card[];
  disabled?: boolean;
}

/** The human records a decision. A known outcome is the service's cue to store an experience card. */
export function DecisionPanel({ client, cards, disabled }: Props) {
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState(emptyFields);
  const [used, setUsed] = useState<string[]>([]);
  const [outcome, setOutcome] = useState('open');
  const [decision, setDecision] = useState<Card | null>(null);
  const [experience, setExperience] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const placed = cards.filter((c): c is Card & { id: string } => Boolean(c.id));
  const passIds = decision?.sections?.cardsUsed ?? used;
  const pass = sourcePassText(cardsSourcePass(placed.filter((card) => passIds.includes(card.id))));

  async function showExperience(decisionId: string): Promise<void> {
    const page = await client.cards_search({ type: 'experience', limit: 200 });
    const linked = page.cards.find((c) =>
      c.edges?.some((e) => e.target === decisionId && e.kind === 'based_on'),
    );
    if (!linked) throw new Error('The experience card was not stored.');
    setExperience(linked);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (used.length === 0) {
      setError('Choose at least one card.');
      return;
    }
    const sections = {
      ...fields,
      cardsUsed: used,
      outcome: outcome.trim(),
    } as DecisionSections;
    const draft: DecisionDraft = {
      format: 2,
      type: 'decision',
      title: title.trim(),
      sections,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await client.decision_create(draft);
      setDecision(saved);
      if (isKnownOutcome(saved.sections?.outcome)) await showExperience(saved.id!);
      else setOutcome('');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onOutcome(event: FormEvent) {
    event.preventDefault();
    if (!decision?.id || !decision.sections) return;
    const text = outcome.trim();
    if (!isKnownOutcome(text)) {
      setError('Enter the outcome. "open" means it is not known yet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await client.decision_save(decision.id, {
        ...decision,
        sections: { ...decision.sections, outcome: text },
      });
      setDecision(saved);
      await showExperience(saved.id!);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setUsed((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  return (
    <section className="wb-panel" aria-labelledby="decision-h" data-testid="decision-panel">
      <h2 id="decision-h">Decision</h2>
      <p className="wb-muted" data-testid="decision-source-pass">
        {pass}
      </p>
      {decision ? (
        <div>
          <p data-testid="decision-saved">{decision.title}</p>
          {experience ? (
            <p data-testid="decision-experience">{experience.title}</p>
          ) : (
            <form onSubmit={onOutcome} data-testid="decision-outcome-form">
              <div className="wb-field">
                <label htmlFor="decision-outcome">Outcome</label>
                <input
                  id="decision-outcome"
                  data-testid="decision-outcome"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="wb-primary"
                data-testid="decision-outcome-submit"
                disabled={busy || disabled}
              >
                Record outcome
              </button>
            </form>
          )}
        </div>
      ) : (
        <form onSubmit={onCreate} data-testid="decision-create-form">
          <div className="wb-field">
            <label htmlFor="decision-title">Title</label>
            <input
              id="decision-title"
              data-testid="decision-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          {FIELDS.map(([key, label]) => (
            <div className="wb-field" key={key}>
              <label htmlFor={`decision-${key}`}>{label}</label>
              <input
                id={`decision-${key}`}
                data-testid={`decision-${key}`}
                value={fields[key]}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                required
              />
            </div>
          ))}
          <fieldset>
            <legend>Cards used</legend>
            {placed.length === 0 ? (
              <p>Place a card before recording a decision.</p>
            ) : (
              placed.map((card) => (
                <label key={card.id}>
                  <input
                    type="checkbox"
                    data-testid={`decision-card-${card.id}`}
                    checked={used.includes(card.id)}
                    onChange={() => toggle(card.id)}
                  />{' '}
                  {card.title}
                </label>
              ))
            )}
          </fieldset>
          <div className="wb-field">
            <label htmlFor="decision-outcome">Outcome</label>
            <input
              id="decision-outcome"
              data-testid="decision-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="wb-primary"
            data-testid="decision-create-submit"
            disabled={busy || disabled || placed.length === 0}
          >
            Record decision
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="wb-error" data-testid="decision-error">
          {error}
        </p>
      )}
    </section>
  );
}
