// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Source pass on a card, a seat, its moves, an edge and a decision (AC-30).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Card } from '@worldbuilder/core';
import { describe, expect, it, vi } from 'vitest';
import type { BoardClient } from './api/client.js';
import { createClient } from './api/client.js';
import { DecisionPanel } from './components/DecisionPanel.js';
import { EdgePanel } from './components/EdgePanel.js';
import { InspectorPanel } from './components/InspectorPanel.js';
import { BASE, TOKEN, makeCard, makeLage } from './testing/mockApi.js';

const hash = (n: string) => `sha256:${n.repeat(64)}`;

const report = makeCard({
  id: '01JA00000000000000000000C1',
  title: 'Wire report',
  contentHash: hash('a'),
  source: 'https://example.org/wire',
});
const repeat = makeCard({
  id: '01JA00000000000000000000C2',
  title: 'Newspaper',
  contentHash: hash('a'),
  source: 'https://example.org/paper',
  edges: [{ target: report.id, kind: 'cites', by: 'human' }],
});
const other = makeCard({
  id: '01JA00000000000000000000C3',
  title: 'Harbour note',
  contentHash: hash('b'),
  source: 'https://example.org/harbour',
});
const navy = makeCard({
  id: '01JA00000000000000000000A1',
  title: 'Coastal navy',
  type: 'organisation',
  collection: 'actors',
  contentHash: hash('c'),
  interests: [{ text: 'Show control', source: report.id }],
  moves: [
    { text: 'Lay mines', source: report.id },
    { text: 'Night transit', source: 'https://example.org/moves' },
  ],
});

function openInspector(card: Card, boardCards: Card[]) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ title: 'Not found', status: 404 }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
  );
  render(
    <InspectorPanel
      client={createClient({ baseUrl: BASE, token: TOKEN, fetch })}
      card={card}
      cardId={card.id}
      boardCards={boardCards}
      stance={undefined}
      onSaveStance={async () => {}}
    />,
  );
  return fetch;
}

describe('source pass on the board', () => {
  it('shows the card pass, the seat entries and the moves', async () => {
    const fetch = openInspector(navy, [navy, report, repeat]);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByTestId('card-source-pass').textContent).toBe('1 finding · 1 origin');
    expect(screen.getByTestId('seat-source-pass').textContent).toBe('3 findings · 2 origins');
    expect(screen.getByTestId('moves-source-pass').textContent).toBe('2 findings · 2 origins');
    expect(screen.getByTestId('seat-entries').textContent).toContain(
      `Interest: Show control (${report.id})`,
    );
    expect(screen.getByTestId('seat-entries').textContent).toContain('Move: Lay mines');
  });

  it('leaves the seat pass off a card that is not an actor', async () => {
    const fetch = openInspector(report, [report, repeat]);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByTestId('card-source-pass').textContent).toBe('2 findings · 1 origin');
    expect(screen.queryByTestId('seat-pass')).toBeNull();
  });

  it('shows the source pass of an edge from its two cards', () => {
    const lage = makeLage({
      cards: [
        { id: report.id, x: 0, y: 0 },
        { id: other.id, x: 1, y: 0 },
      ],
      edges: [{ from: report.id, to: other.id, kind: 'supports', by: 'human' }],
    });
    render(
      <EdgePanel
        lage={lage}
        cards={
          new Map([
            [report.id, report],
            [other.id, other],
          ])
        }
        edgeKind="supports"
        onEdgeKind={() => {}}
        selectedEdgeKey={null}
        onSelectEdge={() => {}}
        onAdd={() => {}}
        onReverse={() => {}}
        onDelete={() => {}}
        onSetKind={() => {}}
      />,
    );
    expect(
      screen.getByTestId(`edge-source-pass-${report.id}>${other.id}:supports`).textContent,
    ).toBe('2 findings · 2 origins');
  });

  it('counts the cards a decision uses, and nothing before one is chosen', () => {
    render(<DecisionPanel client={{} as BoardClient} cards={[report, other]} />);
    expect(screen.getByTestId('decision-source-pass').textContent).toBe('0 findings · 0 origins');
    fireEvent.click(screen.getByTestId(`decision-card-${report.id}`));
    expect(screen.getByTestId('decision-source-pass').textContent).toBe('1 finding · 1 origin');
    fireEvent.click(screen.getByTestId(`decision-card-${other.id}`));
    expect(screen.getByTestId('decision-source-pass').textContent).toBe('2 findings · 2 origins');
  });
});
