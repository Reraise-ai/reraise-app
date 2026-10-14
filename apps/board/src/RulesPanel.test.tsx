// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The rules panel (ADR-0013, AC-03): fired or not, the rule's own text, the triggering cards.
// No percentage. A proposed card is absent because the service never returns one; that exclusion
// is tested in services/api/src/rules.test.ts.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './api/client.js';
import { RulesPanel } from './components/RulesPanel.js';
import {
  BASE,
  CARDS,
  LAGE_ID,
  RULE_FIRED,
  RULE_QUIET,
  TOKEN,
  createMockApi,
} from './testing/mockApi.js';

const C1 = CARDS[0]!.id!;

function open(version = 1) {
  const api = createMockApi();
  const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: api.fetch });
  const onFocusCard = vi.fn();
  const cards = new Map(CARDS.map((c) => [c.id!, c]));
  const view = render(
    <RulesPanel
      client={client}
      lageId={LAGE_ID}
      lageVersion={version}
      cards={cards}
      onFocusCard={onFocusCard}
    />,
  );
  return { api, client, cards, onFocusCard, ...view };
}

describe('rules panel', () => {
  it('lists fired and not fired rules with the triggering card and no percentage', async () => {
    const { api, onFocusCard } = open();
    const fired = await screen.findByTestId(`rules-row-${RULE_FIRED}`);
    expect(fired.getAttribute('data-fired')).toBe('true');
    expect(screen.getByTestId(`rules-fired-${RULE_FIRED}`).textContent).toBe('Fired');
    expect(screen.getByTestId(`rules-then-${RULE_FIRED}`).textContent).toBe('Reroute');
    expect(screen.getByTestId(`rules-trigger-${RULE_FIRED}-${C1}`).textContent).toBe(
      'Strait traffic report',
    );
    const quiet = screen.getByTestId(`rules-row-${RULE_QUIET}`);
    expect(quiet.getAttribute('data-fired')).toBe('false');
    expect(screen.getByTestId(`rules-fired-${RULE_QUIET}`).textContent).toBe('Not fired');
    expect(screen.getByTestId(`rules-then-${RULE_QUIET}`).textContent).toBe('Wait');
    expect(screen.getByTestId(`rules-unmet-${RULE_QUIET}`).textContent).toBe('Condition not met');
    expect(screen.getByTestId('rules-panel').textContent).not.toMatch(
      /%|percent|score|recommend|verdict/i,
    );
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /rules/evaluate');
    expect(api.calls.find((c) => c.path === '/rules/evaluate')?.body).toEqual({ lageId: LAGE_ID });
    await userEvent.click(screen.getByTestId(`rules-trigger-${RULE_FIRED}-${C1}`));
    expect(onFocusCard).toHaveBeenCalledWith(C1);
  });

  it('reads the rules again after the board is saved', async () => {
    const { api, client, cards, rerender } = open(1);
    await screen.findByTestId(`rules-row-${RULE_FIRED}`);
    rerender(
      <RulesPanel
        client={client}
        lageId={LAGE_ID}
        lageVersion={2}
        cards={cards}
        onFocusCard={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/rules/evaluate')).toHaveLength(2),
    );
  });

  it('shows an empty board and a service failure', async () => {
    const empty = {
      lageId: LAGE_ID,
      lageVersion: 1,
      target: 'screen',
      evaluatedAt: '2026-10-14T00:00:00.000Z',
      results: [],
      withheld: 0,
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(empty), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    render(
      <RulesPanel
        client={createClient({ baseUrl: BASE, token: TOKEN, fetch: fetchImpl })}
        lageId={LAGE_ID}
        lageVersion={1}
        cards={new Map()}
        onFocusCard={() => undefined}
      />,
    );
    expect((await screen.findByTestId('rules-empty')).textContent).toBe('No rules.');

    const api = createMockApi();
    api.failNext(500, 'rules down', /POST \/rules\/evaluate/);
    render(
      <RulesPanel
        client={createClient({ baseUrl: BASE, token: TOKEN, fetch: api.fetch })}
        lageId={LAGE_ID}
        lageVersion={1}
        cards={new Map()}
        onFocusCard={() => undefined}
      />,
    );
    expect((await screen.findByTestId('rules-error')).textContent).toMatch(/rules down/);
  });
});
