// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The what-if layer (ADR-0050): saving assumptions writes no card, and recording a decision can
// attach those assumptions.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createClient } from './api/client.js';
import { DecisionPanel } from './components/DecisionPanel.js';
import { ScenarioPanel } from './components/ScenarioPanel.js';
import { BASE, CARDS, LAGE_ID, TOKEN, createMockApi } from './testing/mockApi.js';

const FIELDS = [
  'situation',
  'trigger',
  'conditions',
  'facts',
  'priorities',
  'action',
  'alternatives',
  'exclusions',
  'rationale',
] as const;

describe('what-if layer', () => {
  it('saves assumptions without creating a card and attaches them to a decision', async () => {
    const api = createMockApi();
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: api.fetch });
    render(
      <>
        <ScenarioPanel client={client} lageId={LAGE_ID} />
        <DecisionPanel client={client} lageId={LAGE_ID} cards={CARDS} />
      </>,
    );
    await screen.findByTestId('scenario-empty');
    fireEvent.change(screen.getByTestId('scenario-lines'), {
      target: { value: 'The strait stays closed.\nWar-risk cover doubles.' },
    });
    fireEvent.click(screen.getByTestId('scenario-save'));
    expect((await screen.findByTestId('scenario-assumption-0')).textContent).toBe(
      'The strait stays closed.',
    );
    expect(screen.getByTestId('scenario-assumption-1').textContent).toBe('War-risk cover doubles.');
    expect(api.calls.some((call) => call.method === 'POST' && call.path === '/cards')).toBe(false);
    expect(
      api.calls.find((call) => call.path === `/lagen/${LAGE_ID}/scenario` && call.method === 'PUT')
        ?.body,
    ).toEqual({
      assumptions: [
        { statement: 'The strait stays closed.' },
        { statement: 'War-risk cover doubles.' },
      ],
    });

    fireEvent.change(screen.getByTestId('decision-title'), { target: { value: 'Hold the route' } });
    for (const field of FIELDS) {
      fireEvent.change(screen.getByTestId(`decision-${field}`), {
        target: { value: 'Synthetic text.' },
      });
    }
    fireEvent.click(screen.getByTestId(`decision-card-${CARDS[0]!.id}`));
    fireEvent.click(screen.getByTestId('decision-attach'));
    fireEvent.click(screen.getByTestId('decision-create-submit'));
    const attached = await screen.findByTestId('decision-scenario');
    expect(attached.textContent).toContain('The strait stays closed.');
    expect(attached.textContent).toContain('War-risk cover doubles.');
    const decision = [...api.cards.values()].find((card) => card.type === 'decision');
    expect(decision?.title).toBe('Hold the route');
    expect(JSON.stringify(decision)).not.toContain('The strait stays closed.');
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.method === 'POST' && call.path === `/lagen/${LAGE_ID}/scenario/attach`,
        ),
      ).toBe(true),
    );
  });
});
