// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The decision protocol (AC-12): decisions already in the store are listed, an earlier one opens with
// all eleven sections, and its outcome can be entered in a later visit. A known outcome shows the
// linked experience card; `open` shows none.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './api/client.js';
import { DecisionPanel } from './components/DecisionPanel.js';
import { BASE, CARDS, TOKEN, createMockApi, makeCard } from './testing/mockApi.js';

const USED = CARDS[0]!.id!;
const sections = (outcome: string) => ({
  situation: 'Situation text',
  trigger: 'Trigger text',
  conditions: 'Conditions text',
  facts: 'Facts text',
  priorities: 'Priorities text',
  action: 'Action text',
  alternatives: 'Alternatives text',
  exclusions: 'Exclusions text',
  rationale: 'Rationale text',
  cardsUsed: [USED],
  outcome,
});
const decision = (n: string, outcome: string) =>
  makeCard({
    id: `01JA00000000000000000000${n}`,
    type: 'decision',
    title: `Decision ${n}`,
    sections: sections(outcome),
    contentHash: `sha256:${'a'.repeat(64)}`,
  });

function setup(initial: ReturnType<typeof decision>[] = [], onOutcomeRecorded?: () => void) {
  const api = createMockApi({ cards: initial });
  const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: api.fetch });
  render(
    <DecisionPanel
      client={client}
      cards={CARDS}
      {...(onOutcomeRecorded ? { onOutcomeRecorded } : {})}
    />,
  );
  return api;
}

describe('decision protocol', () => {
  it('tells the board once a known outcome is stored, and not for an open one', async () => {
    const recorded = vi.fn();
    const earlier = decision('D8', 'open');
    setup([earlier], recorded);
    await screen.findByTestId(`decision-protocol-${earlier.id}`);
    fireEvent.click(screen.getByText('Decision D8'));
    expect(recorded).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('decision-outcome'), { target: { value: 'It held.' } });
    fireEvent.click(screen.getByTestId('decision-outcome-submit'));
    await screen.findByTestId('decision-experience');
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it('says so when no decision is stored', async () => {
    setup();
    expect((await screen.findByTestId('decision-protocol-empty')).textContent).toContain(
      'No decision is stored yet',
    );
  });

  it('also tells the board when a new decision is created with a known outcome', async () => {
    const recorded = vi.fn();
    setup([], recorded);
    await screen.findByTestId('decision-protocol-empty');
    const create = async (outcome: string) => {
      fireEvent.change(screen.getByTestId('decision-title'), { target: { value: 'New choice' } });
      for (const key of [
        'situation',
        'trigger',
        'conditions',
        'facts',
        'priorities',
        'action',
        'alternatives',
        'exclusions',
        'rationale',
      ]) {
        fireEvent.change(screen.getByTestId(`decision-${key}`), { target: { value: 'Text' } });
      }
      fireEvent.click(screen.getByTestId(`decision-card-${USED}`));
      fireEvent.change(screen.getByTestId('decision-outcome'), { target: { value: outcome } });
      fireEvent.click(screen.getByTestId('decision-create-submit'));
      await screen.findByTestId('decision-saved');
    };
    await create('open');
    expect(recorded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('decision-new'));
    await create('It held.');
    await waitFor(() => expect(recorded).toHaveBeenCalledTimes(1));
  });

  it('lists an earlier decision, opens it with all eleven sections and takes its outcome later', async () => {
    const earlier = decision('D9', 'open');
    const api = setup([earlier]);
    await screen.findByTestId(`decision-protocol-${earlier.id}`);
    expect(screen.getByTestId(`decision-protocol-outcome-${earlier.id}`).textContent).toBe('open');

    fireEvent.click(screen.getByText('Decision D9'));
    expect(screen.getByTestId('decision-saved').textContent).toBe('Decision D9');
    for (const [key, text] of [
      ['situation', 'Situation text'],
      ['trigger', 'Trigger text'],
      ['conditions', 'Conditions text'],
      ['facts', 'Facts text'],
      ['priorities', 'Priorities text'],
      ['action', 'Action text'],
      ['alternatives', 'Alternatives text'],
      ['exclusions', 'Exclusions text'],
      ['rationale', 'Rationale text'],
      ['cardsUsed', CARDS[0]!.title],
      ['outcome', 'open'],
    ] as const) {
      expect(screen.getByTestId(`decision-section-${key}`).textContent).toBe(text);
    }
    expect(screen.queryByTestId('decision-experience')).toBeNull();

    fireEvent.change(screen.getByTestId('decision-outcome'), {
      target: { value: 'Rerouted via the Cape.' },
    });
    fireEvent.click(screen.getByTestId('decision-outcome-submit'));
    expect((await screen.findByTestId('decision-experience')).textContent).toBe(
      'Experience: Decision D9',
    );
    const put = api.calls.find((c) => c.method === 'PUT' && c.path === `/decisions/${earlier.id}`);
    expect(put?.body).toMatchObject({ sections: { outcome: 'Rerouted via the Cape.' } });
    await waitFor(() =>
      expect(screen.getByTestId(`decision-protocol-outcome-${earlier.id}`).textContent).toBe(
        'Rerouted via the Cape.',
      ),
    );
    expect([...api.cards.values()].filter((c) => c.type === 'experience')).toHaveLength(1);
  });

  it('opens a decision whose outcome is known with its experience card, and returns to the form', async () => {
    const known = decision('D8', 'Held the route.');
    const api = setup([known]);
    api.cards.set(
      '01JA00000000000000000000E8',
      makeCard({
        id: '01JA00000000000000000000E8',
        type: 'experience',
        layer: 'experience',
        title: 'Experience: Decision D8',
        edges: [{ target: known.id!, kind: 'based_on', by: 'human' }],
      }),
    );
    fireEvent.click(await screen.findByText('Decision D8'));
    expect((await screen.findByTestId('decision-experience')).textContent).toBe(
      'Experience: Decision D8',
    );
    expect(screen.queryByTestId('decision-outcome-form')).toBeNull();
    fireEvent.click(screen.getByTestId('decision-new'));
    expect(screen.getByTestId('decision-create-form')).toBeTruthy();
    expect((screen.getByTestId('decision-outcome') as HTMLInputElement).value).toBe('open');
  });

  it('starts a new decision with an empty form', async () => {
    setup();
    await screen.findByTestId('decision-protocol-empty');
    fireEvent.change(screen.getByTestId('decision-title'), { target: { value: 'First choice' } });
    for (const key of [
      'situation',
      'trigger',
      'conditions',
      'facts',
      'priorities',
      'action',
      'alternatives',
      'exclusions',
      'rationale',
    ]) {
      fireEvent.change(screen.getByTestId(`decision-${key}`), { target: { value: 'Old text' } });
    }
    fireEvent.click(screen.getByTestId(`decision-card-${USED}`));
    fireEvent.click(screen.getByTestId('decision-create-submit'));
    await screen.findByTestId('decision-saved');
    fireEvent.click(screen.getByTestId('decision-new'));
    expect((screen.getByTestId('decision-title') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('decision-situation') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId(`decision-card-${USED}`) as HTMLInputElement).checked).toBe(false);
  });

  it('shows a refused list call and keeps the form usable', async () => {
    const api = createMockApi();
    api.failNext(500, 'store unavailable', /^GET \/cards/);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: api.fetch });
    render(<DecisionPanel client={client} cards={CARDS} />);
    expect((await screen.findByTestId('decision-error')).textContent).toContain(
      'store unavailable',
    );
    expect(screen.getByTestId('decision-create-form')).toBeTruthy();
  });
});
