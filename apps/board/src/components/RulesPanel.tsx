// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Which of the user's rules fire on this board (ADR-0013). The text is the rule's own `then`.
// There is no percentage, score or recommendation. A proposed card never appears here: the
// service evaluates accepted cards only.

import { useEffect, useState } from 'react';
import type { Card, RuleEvaluation } from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
  lageId: string;
  /** Re-read the rules when the board is saved. */
  lageVersion: number;
  cards: Map<string, Card>;
  onFocusCard(id: string): void;
}

/** The rules of this board, fired or not, with the cards that triggered them. */
export function RulesPanel({ client, lageId, lageVersion, cards, onFocusCard }: Props) {
  const [evaluation, setEvaluation] = useState<RuleEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [client, lageId, lageVersion]);

  return (
    <section className="wb-panel" aria-labelledby="rules-h" data-testid="rules-panel">
      <h2 id="rules-h">Rules</h2>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
