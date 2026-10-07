// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useState } from 'react';
import type { Card, EdgeKind, Lage, LageEdge } from '@worldbuilder/core';
import { EDGE_KINDS_DRAWN, edgeKey, type DrawnEdgeKind } from '../lageModel.js';

interface Props {
  lage: Lage;
  cards: ReadonlyMap<string, Card>;
  edgeKind: DrawnEdgeKind;
  onEdgeKind(kind: DrawnEdgeKind): void;
  selectedEdgeKey: string | null;
  onSelectEdge(key: string | null): void;
  disabled?: boolean;
  onAdd(from: string, to: string, kind: EdgeKind): void;
  onReverse(edge: LageEdge): void;
  onDelete(edge: LageEdge): void;
  onSetKind(edge: LageEdge, kind: EdgeKind): void;
}

const titleOf = (cards: ReadonlyMap<string, Card>, id: string) => cards.get(id)?.title ?? id;

/**
 * Edges as a list with a form: the keyboard path to everything the canvas drag does. Kinds the
 * board draws: supports and refutes; other kinds read from a store are shown and kept.
 */
export function EdgePanel(props: Props) {
  const { lage, cards, edgeKind, selectedEdgeKey } = props;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const placed = lage.cards.map((c) => c.id);

  return (
    <section aria-labelledby="edges-h" data-testid="edge-panel">
      <h2 id="edges-h">Edges</h2>
      <div className="wb-field">
        <label htmlFor="edge-kind">Kind of the next edge</label>
        <select
          id="edge-kind"
          data-testid="edge-kind-select"
          value={edgeKind}
          onChange={(e) => props.onEdgeKind(e.target.value as DrawnEdgeKind)}
        >
          {EDGE_KINDS_DRAWN.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <form
        className="wb-row"
        aria-label="Add an edge"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to && from !== to) props.onAdd(from, to, edgeKind);
        }}
      >
        <div className="wb-field">
          <label htmlFor="edge-from">From</label>
          <select
            id="edge-from"
            data-testid="edge-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">Choose a card</option>
            {placed.map((id) => (
              <option key={id} value={id}>
                {titleOf(cards, id)}
              </option>
            ))}
          </select>
        </div>
        <div className="wb-field">
          <label htmlFor="edge-to">To</label>
          <select
            id="edge-to"
            data-testid="edge-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Choose a card</option>
            {placed.map((id) => (
              <option key={id} value={id}>
                {titleOf(cards, id)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          data-testid="edge-add"
          disabled={props.disabled || !from || !to || from === to}
        >
          Add edge
        </button>
      </form>
      {lage.edges.length === 0 && (
        <p className="wb-muted">No edges yet. Drag from one card to another.</p>
      )}
      <ul className="wb-list" aria-label="Edges on this board">
        {lage.edges.map((e) => {
          const key = edgeKey(e);
          const selected = key === selectedEdgeKey;
          return (
            <li
              key={key}
              data-testid={`edge-row-${key}`}
              data-selected={selected ? 'true' : 'false'}
            >
              <button
                type="button"
                data-testid={`edge-select-${key}`}
                aria-pressed={selected}
                onClick={() => props.onSelectEdge(selected ? null : key)}
              >
                {titleOf(cards, e.from)} {e.kind} {titleOf(cards, e.to)}
              </button>{' '}
              <span className="wb-muted">by {e.by}</span>
              {selected && (
                <div className="wb-row">
                  <label htmlFor={`edge-kind-${key}`} className="wb-visually-hidden">
                    Kind of this edge
                  </label>
                  <select
                    id={`edge-kind-${key}`}
                    data-testid="edge-kind-edit"
                    value={e.kind}
                    disabled={props.disabled}
                    onChange={(ev) => props.onSetKind(e, ev.target.value as EdgeKind)}
                  >
                    {[...new Set<string>([...EDGE_KINDS_DRAWN, e.kind])].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="edge-reverse"
                    disabled={props.disabled}
                    onClick={() => props.onReverse(e)}
                  >
                    Reverse
                  </button>
                  <button
                    type="button"
                    data-testid="edge-delete"
                    disabled={props.disabled}
                    onClick={() => props.onDelete(e)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
