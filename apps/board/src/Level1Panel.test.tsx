// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The Level 1 panel (ADR-0035, ADR-0045) against the fetch stub: the estimate text, the moves and
// the cards used, the basis on demand, the what-if re-run (debounced, local engine only), the
// stale badge, the cloud transfer flow and the escalation. No verdict wording anywhere.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { createClient } from './api/client.js';
import { saveSession } from './api/session.js';
import { Level1Panel } from './components/Level1Panel.js';
import {
  ASSUMPTION,
  BASE,
  LAGE_ID,
  LEVEL1_CARDS,
  LEVEL1_CLOUD,
  LEVEL1_JEV,
  LEVEL1_LOCAL,
  ORG_A,
  ORG_B,
  TOKEN,
  createMockApi,
  makeLage,
  type MockApi,
} from './testing/mockApi.js';

const DEBOUNCE = 40;
// The whole workspace runs in parallel in CI: allow slow machines.
configure({ asyncUtilTimeout: 4000 });

function mock(extra: { players?: boolean } = {}): MockApi {
  const placed = [...(extra.players === false ? [] : [ORG_A, ORG_B]), ASSUMPTION].map(
    (cardId, i) => ({ id: cardId, x: i * 240, y: 0 }),
  );
  return createMockApi({ lage: makeLage({ cards: placed }), cards: LEVEL1_CARDS });
}

async function open(api: MockApi) {
  saveSession({ baseUrl: BASE, token: TOKEN });
  const view = render(
    <App fetchImpl={api.fetch} pollIntervalMs={30} level1DebounceMs={DEBOUNCE} />,
  );
  await userEvent.click(await screen.findByTestId(`lage-open-${LAGE_ID}`));
  await screen.findByTestId('level1-panel');
  await screen.findByTestId(`card-node-${ASSUMPTION}`);
  await waitFor(() =>
    expect((screen.getByTestId('level1-run') as HTMLButtonElement).disabled).toBe(false),
  );
  return view;
}

const predicts = (api: MockApi) => api.level1.predicts;

async function setStance(cardId: string, position: string) {
  fireEvent.click(screen.getByTestId(`card-node-${cardId}`));
  await screen.findByTestId('stance-form');
  await userEvent.selectOptions(screen.getByTestId('stance-position'), position);
  await userEvent.click(screen.getByTestId('stance-save'));
  await waitFor(() => expect(screen.getByTestId('stance-status').textContent).toMatch(/Saved/));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Level 1 panel: estimates', () => {
  it('shows "<engine> estimates ..." per player with the moves and the cards used, never a verdict', async () => {
    const api = mock();
    await open(api);
    expect(screen.queryByTestId('level1-results')).toBeNull();
    await userEvent.click(screen.getByTestId('level1-run'));
    const text = await screen.findByTestId(`level1-estimate-${ORG_A}`);
    expect(text.textContent).toBe('local-rules estimates 0.58 for Hold position');
    expect(screen.getByTestId(`level1-estimate-${ORG_B}`).textContent).toBe(
      'local-rules estimates 0.58 for Hold position',
    );
    expect(predicts(api)).toEqual([{ engine: 'local', trigger: { kind: 'manual' } }]);

    const options = within(screen.getByTestId(`level1-player-${ORG_A}`)).getAllByRole('listitem');
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Hold position (estimated)', 'Escalate']),
    );
    const panel = screen.getByTestId('level1-panel').textContent ?? '';
    expect(panel).not.toMatch(/verdict|recommend|the answer is|you should|best option|winner/i);
    expect(panel).toMatch(/not a decision/);
  });

  it('focuses a card of the board when its id is clicked', async () => {
    const api = mock();
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    const used = screen.getByTestId(`level1-card-${ORG_A}-${ASSUMPTION}`);
    expect(used.textContent).toBe('Assumption: the talks succeed');
    expect(screen.getByTestId(`card-node-${ASSUMPTION}`).getAttribute('data-selected')).toBe(
      'false',
    );
    await userEvent.click(used);
    await waitFor(() =>
      expect(screen.getByTestId(`card-node-${ASSUMPTION}`).getAttribute('data-selected')).toBe(
        'true',
      ),
    );
    expect(screen.getByTestId('inspector-title').textContent).toBe('Assumption: the talks succeed');
  });

  it('fetches the basis only on demand, for the local engine, with clickable cards', async () => {
    const api = mock();
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    const explains = () => api.calls.filter((c) => c.path.includes('explain=true'));
    expect(explains()).toHaveLength(0);
    await userEvent.click(screen.getByTestId(`level1-basis-toggle-${ORG_A}`));
    const basis = await screen.findByTestId(`level1-basis-${ORG_A}`);
    await within(basis).findByTestId(`level1-basis-option-${ORG_A}-0`);
    expect(explains()).toHaveLength(1);
    expect(basis.textContent).toMatch(/past moves: 1.00/);
    expect(basis.textContent).toMatch(/not a probability/);
    // A second player's basis reuses the one answer.
    await userEvent.click(screen.getByTestId(`level1-basis-toggle-${ORG_B}`));
    await screen.findByTestId(`level1-basis-option-${ORG_B}-0`);
    expect(explains()).toHaveLength(1);
    await userEvent.click(screen.getByTestId(`level1-basis-toggle-${ORG_A}`));
    expect(screen.queryByTestId(`level1-basis-${ORG_A}`)).toBeNull();
  });

  it('says so when there is nothing to estimate', async () => {
    const api = mock({ players: false });
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    expect((await screen.findByTestId('level1-note')).textContent).toMatch(/nothing to estimate/);
    expect(screen.queryByTestId('level1-results')).toBeNull();
  });

  it('lists an engine that is not configured as unavailable and cannot run it', async () => {
    const api = mock();
    await open(api);
    const option = within(screen.getByTestId('level1-engine')).getByText(/Jev/);
    expect(option.textContent).toMatch(/unavailable: not configured/);
    expect((option as HTMLOptionElement).disabled).toBe(true);
  });

  it('shows a failure of the service instead of an estimate', async () => {
    const api = mock();
    await open(api);
    api.failNext(502, 'Bad gateway', /level1$/, 'the engine did not give a usable answer');
    await userEvent.click(screen.getByTestId('level1-run'));
    expect((await screen.findByTestId('level1-error')).textContent).toMatch(
      /did not give a usable answer \(502\)/,
    );
  });

  it('reports a dropped answer when the service says the board changed meanwhile', async () => {
    const api = mock();
    const real = api.fetch;
    let once = true;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (once && init?.method === 'POST' && String(input).endsWith('/level1')) {
        once = false;
        return new Response(JSON.stringify({ status: 'superseded', engine: 'local-rules' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    }) as typeof fetch;
    saveSession({ baseUrl: BASE, token: TOKEN });
    render(<App fetchImpl={fetchImpl} pollIntervalMs={30} level1DebounceMs={DEBOUNCE} />);
    await userEvent.click(await screen.findByTestId(`lage-open-${LAGE_ID}`));
    await waitFor(() =>
      expect((screen.getByTestId('level1-run') as HTMLButtonElement).disabled).toBe(false),
    );
    await userEvent.click(screen.getByTestId('level1-run'));
    expect((await screen.findByTestId('level1-note')).textContent).toMatch(/estimate was dropped/);
    expect(screen.queryByTestId('level1-results')).toBeNull();
  });
});

describe('Level 1 panel: cards left out', () => {
  it('lists the cards the service left out of the request and shows the basis on the 0 to 1 scale', async () => {
    const api = mock();
    const real = api.fetch;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await real(input, init);
      if (init?.method === 'POST' && String(input).endsWith('/level1')) {
        const body = (await res.json()) as object;
        return new Response(
          JSON.stringify({
            ...body,
            skipped: [{ cardId: ORG_B, reason: 'not a valid card; left out of the request' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return res;
    }) as typeof fetch;
    saveSession({ baseUrl: BASE, token: TOKEN });
    render(<App fetchImpl={fetchImpl} pollIntervalMs={30} level1DebounceMs={DEBOUNCE} />);
    await userEvent.click(await screen.findByTestId(`lage-open-${LAGE_ID}`));
    await waitFor(() =>
      expect((screen.getByTestId('level1-run') as HTMLButtonElement).disabled).toBe(false),
    );
    await userEvent.click(screen.getByTestId('level1-run'));
    expect((await screen.findByTestId('level1-skipped')).textContent).toMatch(/Tanker consortium/);
    await userEvent.click(await screen.findByTestId(`level1-basis-toggle-${ORG_A}`));
    const row = await screen.findByTestId(`level1-basis-option-${ORG_A}-0`);
    expect(row.textContent).toMatch(/0\.58/);
    expect(row.textContent).not.toMatch(/%/);
  });
});

describe('Level 1 panel: what-if and stale', () => {
  it('runs the local engine again after an assumption changed, and shows what moved', async () => {
    const api = mock();
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    expect(predicts(api)).toHaveLength(1);

    await setStance(ASSUMPTION, 'rejected');
    await waitFor(() =>
      expect(screen.getByTestId(`level1-estimate-${ORG_A}`).textContent).toBe(
        'local-rules estimates 0.71 for Escalate',
      ),
    );
    expect(predicts(api)).toHaveLength(2);
    expect(predicts(api)[1]).toEqual({
      engine: 'local',
      trigger: { kind: 'assumption_changed', cardIds: [ASSUMPTION] },
    });
    expect(screen.getByTestId(`level1-changed-${ORG_A}`).textContent).toMatch(
      /from "Hold position" to "Escalate"/,
    );
    expect(screen.queryByTestId('level1-stale')).toBeNull();
  });

  it('does not run by itself when the option is off, and marks the estimate stale instead', async () => {
    const api = mock();
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    await userEvent.click(screen.getByTestId('level1-auto'));
    await setStance(ASSUMPTION, 'rejected');
    expect(await screen.findByTestId('level1-stale')).toBeTruthy();
    expect(predicts(api)).toHaveLength(1);
    expect(screen.getByTestId(`level1-estimate-${ORG_A}`).textContent).toBe(
      'local-rules estimates 0.58 for Hold position',
    );
    expect(screen.getByTestId('level1-results').getAttribute('data-stale')).toBe('true');
    expect((screen.getByTestId(`level1-escalate-${ORG_A}`) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.click(screen.getByTestId('level1-run'));
    await waitFor(() => expect(screen.queryByTestId('level1-stale')).toBeNull());
    expect(screen.getByTestId(`level1-estimate-${ORG_A}`).textContent).toMatch(
      /0\.71 for Escalate/,
    );
  });

  it('waits 500 ms after the last change by default, and runs once for several changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const api = mock();
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: api.fetch });
    const lage = api.cards.get(LAGE_ID)!.lage!;
    const cards = new Map(LEVEL1_CARDS.map((c) => [c.id!, c] as const));
    const stance = (position: 'believed' | 'rejected') => ({
      cardId: ASSUMPTION,
      position,
      weight: 1,
      updatedAt: '2026-10-07T10:00:00Z',
      history: [],
    });
    const element = (stances: Map<string, ReturnType<typeof stance>>) => (
      <Level1Panel
        client={client}
        lageId={LAGE_ID}
        lage={lage}
        cards={cards}
        stances={stances}
        onFocusCard={() => undefined}
        onOpenLage={() => undefined}
      />
    );
    const view = render(element(new Map()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(predicts(api)).toHaveLength(0);

    view.rerender(element(new Map([[ASSUMPTION, stance('believed')]])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    view.rerender(element(new Map([[ASSUMPTION, stance('rejected')]])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // The same content in new objects (a reload) neither cancels nor restarts the wait.
    view.rerender(element(new Map([[ASSUMPTION, stance('rejected')]])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(predicts(api)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(predicts(api)).toHaveLength(1);
    expect(predicts(api)[0]?.trigger).toEqual({
      kind: 'assumption_changed',
      cardIds: [ASSUMPTION],
    });
  });

  it('refreshes the stale badge when something else on the board changes, without a run', async () => {
    const api = mock();
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    // Not an assumption: another card is placed through the search panel.
    api.cards.set(ORG_B, {
      ...api.cards.get(ORG_B)!,
      body: 'Edited elsewhere.',
      contentHash: `sha256:${'1'.repeat(64)}`,
    });
    api.addProposal({
      author: 'agent:scout',
      kind: 'place_card',
      payload: { lageId: LAGE_ID, cardId: '01JA00000000000000000000C1', x: 5, y: 5 },
    });
    await userEvent.click(await screen.findByTestId(/proposal-accept-/));
    expect(await screen.findByTestId('level1-stale')).toBeTruthy();
    expect(predicts(api)).toHaveLength(1);
  });
});

describe('Level 1 panel: cloud engines', () => {
  async function cloudPanel() {
    const api = mock();
    api.level1.engines = [LEVEL1_LOCAL, LEVEL1_CLOUD, LEVEL1_JEV];
    await open(api);
    await userEvent.selectOptions(screen.getByTestId('level1-engine'), 'scripted-cloud');
    return api;
  }

  it('previews the whole envelope first and sends only after the confirmation', async () => {
    const api = await cloudPanel();
    expect((screen.getByTestId('level1-auto') as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByTestId('level1-run'));
    const preview = await screen.findByTestId('level1-preview');
    expect(screen.getByTestId('level1-envelope-connector').textContent).toBe('scripted-cloud');
    expect(screen.getByTestId('level1-envelope-request').textContent).toMatch(/outputSchema/);
    expect(preview.querySelectorAll('[data-testid^="level1-send-"]').length).toBe(3);
    expect(api.level1.cloudSends).toBe(0);
    expect(screen.queryByTestId('level1-results')).toBeNull();

    await userEvent.click(screen.getByTestId('level1-confirm'));
    const text = await screen.findByTestId(`level1-estimate-${ORG_A}`);
    expect(text.textContent).toBe('scripted-cloud estimates 0.58 for Hold position');
    expect(api.level1.cloudSends).toBe(1);
    expect(screen.queryByTestId('level1-preview')).toBeNull();
    expect(predicts(api).at(-1)?.transferId).toBeTruthy();
    // A cloud engine gives no basis.
    await userEvent.click(screen.getByTestId(`level1-basis-toggle-${ORG_A}`));
    expect((await screen.findByTestId(`level1-basis-note-${ORG_A}`)).textContent).toMatch(
      /gives no basis/,
    );
  });

  it('cancelling the preview sends nothing', async () => {
    const api = await cloudPanel();
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId('level1-preview');
    await userEvent.click(screen.getByTestId('level1-cancel'));
    expect(screen.queryByTestId('level1-preview')).toBeNull();
    expect(api.level1.cloudSends).toBe(0);
    expect(api.calls.some((c) => c.path.endsWith('/confirm'))).toBe(false);
  });

  it('never re-runs a cloud engine by itself: a change only makes the estimate stale', async () => {
    const api = await cloudPanel();
    await userEvent.click(screen.getByTestId('level1-run'));
    await userEvent.click(await screen.findByTestId('level1-confirm'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    const before = predicts(api).length;
    await setStance(ASSUMPTION, 'rejected');
    expect(await screen.findByTestId('level1-stale')).toBeTruthy();
    expect(screen.getByTestId('level1-stale').textContent).toMatch(
      /new preview and your confirmation/,
    );
    await new Promise((r) => setTimeout(r, DEBOUNCE * 4));
    expect(predicts(api)).toHaveLength(before);
    expect(api.level1.cloudSends).toBe(1);
    // Estimating again starts a new preview, which needs a new confirmation.
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId('level1-preview');
    expect(api.level1.cloudSends).toBe(1);
  });

  it('shows a refused transfer and drops the preview', async () => {
    const api = await cloudPanel();
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId('level1-preview');
    api.failNext(409, 'Conflict', /level1$/, 'the board changed since the preview');
    await userEvent.click(screen.getByTestId('level1-confirm'));
    expect((await screen.findByTestId('level1-error')).textContent).toMatch(/board changed/);
    expect(screen.queryByTestId('level1-preview')).toBeNull();
  });
});

describe('Level 1 panel: escalation', () => {
  it('creates a board analysis for one player and opens it', async () => {
    const api = mock();
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    await userEvent.click(screen.getByTestId(`level1-escalate-${ORG_A}`));
    const done = await screen.findByTestId('level1-analysis');
    expect(done.textContent).toMatch(/Next move of Coastal navy/);
    const post = api.calls.find((c) => c.path.endsWith('/level1/escalate'))!;
    expect(post.body).toEqual({ playerCardId: ORG_A });
    await userEvent.click(screen.getByTestId('level1-open-analysis'));
    await waitFor(() =>
      expect(screen.getByTestId('board-title').textContent).toBe(
        'Next move of Coastal navy (fictional)',
      ),
    );
  });

  it('shows why an escalation failed', async () => {
    const api = mock();
    await open(api);
    await userEvent.click(screen.getByTestId('level1-run'));
    await screen.findByTestId(`level1-estimate-${ORG_A}`);
    api.failNext(409, 'Conflict', /escalate$/, 'the prediction is stale; estimate again first');
    await userEvent.click(screen.getByTestId(`level1-escalate-${ORG_A}`));
    expect((await screen.findByTestId('level1-error')).textContent).toMatch(/prediction is stale/);
  });
});
