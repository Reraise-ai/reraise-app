// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import { saveSession } from './api/session.js';
import {
  BASE,
  CARDS,
  LAGE_ID,
  TOKEN,
  createMockApi,
  makeLage,
  type MockApi,
} from './testing/mockApi.js';

const [C1, C2, C3, C4] = CARDS.map((c) => c.id!) as [string, string, string, string];

function signedIn(api: MockApi) {
  saveSession({ baseUrl: BASE, token: TOKEN });
  return render(<App fetchImpl={api.fetch} pollIntervalMs={30} />);
}

async function openLage(api: MockApi) {
  const view = signedIn(api);
  await userEvent.click(await screen.findByTestId(`lage-open-${LAGE_ID}`));
  await screen.findByTestId('workbench');
  await screen.findByTestId(`card-node-${C1}`);
  return view;
}

const lageOf = (api: MockApi) => api.cards.get(LAGE_ID)!.lage!;
const puts = (api: MockApi) =>
  api.calls.filter((c) => c.method === 'PUT' && c.path === `/lagen/${LAGE_ID}`);

describe('sign in', () => {
  it('checks the pasted token, keeps it in sessionStorage and sends it as X-Worldbuilder-Session', async () => {
    const api = createMockApi();
    render(<App fetchImpl={api.fetch} />);
    await userEvent.clear(screen.getByTestId('login-base-url'));
    await userEvent.type(screen.getByTestId('login-base-url'), BASE);
    await userEvent.type(screen.getByTestId('login-token'), 'wrong');
    await userEvent.click(screen.getByTestId('login-submit'));
    expect((await screen.findByTestId('login-error')).textContent).toMatch(/did not accept/);
    expect(sessionStorage.getItem('wb.session')).toBeNull();

    await userEvent.clear(screen.getByTestId('login-token'));
    await userEvent.type(screen.getByTestId('login-token'), TOKEN);
    await userEvent.click(screen.getByTestId('login-submit'));
    await screen.findByTestId('lage-list');
    expect(JSON.parse(sessionStorage.getItem('wb.session')!)).toEqual({
      baseUrl: BASE,
      token: TOKEN,
    });
    expect(localStorage.length).toBe(0);
    expect(api.calls.at(-1)!.headers['x-worldbuilder-session']).toBe(TOKEN);
  });

  it('asks for a token before calling the service', async () => {
    const api = createMockApi();
    render(<App fetchImpl={api.fetch} />);
    await userEvent.click(screen.getByTestId('login-submit'));
    expect((await screen.findByTestId('login-error')).textContent).toMatch(
      /Paste the session token/,
    );
    expect(api.calls).toHaveLength(0);
  });

  it('shows a transport failure instead of failing silently', async () => {
    render(<App fetchImpl={(() => Promise.reject(new Error('refused'))) as typeof fetch} />);
    await userEvent.type(screen.getByTestId('login-token'), TOKEN);
    await userEvent.click(screen.getByTestId('login-submit'));
    expect((await screen.findByTestId('login-error')).textContent).toMatch(/refused/);
  });

  it('signs out: the token leaves sessionStorage', async () => {
    const api = createMockApi();
    signedIn(api);
    await screen.findByTestId('lage-list');
    await userEvent.click(screen.getByTestId('session-signout'));
    expect(sessionStorage.getItem('wb.session')).toBeNull();
    expect(screen.getByTestId('login-form')).toBeTruthy();
  });

  it('drops a session the service no longer accepts', async () => {
    const api = createMockApi();
    saveSession({ baseUrl: BASE, token: 'stale' });
    render(<App fetchImpl={api.fetch} />);
    await screen.findByTestId('login-form');
    expect(sessionStorage.getItem('wb.session')).toBeNull();
  });
});

describe('Lage list and creation', () => {
  it('lists Lagen and opens one', async () => {
    const api = createMockApi();
    await openLage(api);
    expect(screen.getByTestId('board-title').textContent).toBe('Hormuz reroute');
    expect(screen.getByTestId('board-version').textContent).toBe('1');
  });

  it('creates a Lage (lage_create) and opens its board', async () => {
    const api = createMockApi();
    signedIn(api);
    await screen.findByTestId('lage-list');
    await userEvent.type(screen.getByTestId('lage-create-title'), 'Palma ferries');
    await userEvent.type(screen.getByTestId('lage-create-question'), 'Add a route?');
    await userEvent.type(screen.getByTestId('lage-create-options'), 'Yes{Enter}No');
    await userEvent.click(screen.getByTestId('lage-create-submit'));
    await screen.findByTestId('workbench');
    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/lagen')!;
    expect(post.body).toMatchObject({
      title: 'Palma ferries',
      worlds: [expect.any(String)],
      lage: { question: 'Add a route?', options: ['Yes', 'No'], version: 1, cards: [], edges: [] },
    });
    expect(screen.getByTestId('board-title').textContent).toBe('Palma ferries');
  });
});

describe('board canvas', () => {
  it('shows the layers distinctly with a text label, the author of agent cards, and no stance by default', async () => {
    const api = createMockApi({
      lage: makeLage({
        cards: [C1, C2, C3, C4].map((id, i) => ({ id, x: i * 280, y: 0 })),
      }),
    });
    await openLage(api);
    await screen.findByTestId(`card-node-${C4}`);
    expect(screen.getByTestId(`card-node-${C1}`).dataset['layer']).toBe('evidenced');
    expect(screen.getByTestId(`card-node-${C2}`).dataset['layer']).toBe('said');
    expect(screen.getByTestId(`card-node-${C3}`).dataset['layer']).toBe('experience');
    expect(screen.getByTestId(`card-layer-${C1}`).textContent).toBe('Evidenced');
    expect(screen.getByTestId(`card-layer-${C2}`).textContent).toBe('Said');
    expect(screen.getByTestId(`card-layer-${C3}`).textContent).toBe('Experience');
    expect(screen.getByTestId(`card-author-${C4}`).textContent).toBe('agent:scout');
    expect(screen.queryByTestId(`card-author-${C1}`)).toBeNull();
    expect(screen.queryByTestId(`card-stance-${C1}`)).toBeNull();
  });

  it('shows the own stance of the user as an overlay on the card, from the screen package', async () => {
    const api = createMockApi();
    api.stances.set(C1, {
      cardId: C1,
      position: 'believed',
      weight: 0.8,
      updatedAt: '2026-10-06T10:00:00.000Z',
      history: [],
    });
    await openLage(api);
    expect((await screen.findByTestId(`card-stance-${C1}`)).textContent).toBe(
      'You: believed, weight 0.8',
    );
    expect(screen.queryByTestId(`card-stance-${C2}`)).toBeNull();
  });

  it('marks a card the screen cannot read instead of inventing content', async () => {
    const api = createMockApi({
      lage: makeLage({ cards: [{ id: '01JA000000000000000000ZZ99', x: 0, y: 0 }] }),
    });
    signedIn(api);
    await userEvent.click(await screen.findByTestId(`lage-open-${LAGE_ID}`));
    const node = await screen.findByTestId('card-node-01JA000000000000000000ZZ99');
    expect(node.dataset['withheld']).toBe('true');
    expect(node.textContent).toMatch(/not shown on this screen/);
  });
});

describe('search and place', () => {
  it('searches cards and places one with the version guard (lage_save version + 1)', async () => {
    const api = createMockApi();
    await openLage(api);
    await userEvent.type(screen.getByTestId('search-input'), 'port');
    await userEvent.click(screen.getByTestId('search-submit'));
    await screen.findByTestId(`search-result-${C3}`);
    expect(screen.queryByTestId(`search-result-${C2}`)).toBeNull();
    expect(screen.queryByTestId(`search-result-${LAGE_ID}`)).toBeNull();
    await userEvent.click(screen.getByTestId(`search-place-${C3}`));
    await screen.findByTestId(`card-node-${C3}`);
    const put = puts(api)[0]!;
    expect(put.body).toMatchObject({
      version: 2,
      cards: [{ id: C1 }, { id: C2 }, { id: C3, x: 560, y: 0 }],
    });
    expect(lageOf(api).version).toBe(2);
    expect(screen.getByTestId('board-version').textContent).toBe('2');
    expect((screen.getByTestId(`search-place-${C3}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('on a version conflict reloads the board and asks to repeat', async () => {
    const api = createMockApi();
    await openLage(api);
    await screen.findByTestId(`search-place-${C3}`);
    api.bumpLage(LAGE_ID);
    await userEvent.click(screen.getByTestId(`search-place-${C3}`));
    await waitFor(() =>
      expect(screen.getByTestId('board-message').textContent).toMatch(/changed elsewhere/),
    );
    await waitFor(() => expect(screen.getByTestId('board-version').textContent).toBe('2'));
    expect(lageOf(api).cards.map((c) => c.id)).not.toContain(C3);
    await userEvent.click(screen.getByTestId(`search-place-${C3}`));
    await screen.findByTestId(`card-node-${C3}`);
    expect(lageOf(api).version).toBe(3);
  });

  it('shows a save failure', async () => {
    const api = createMockApi();
    await openLage(api);
    await screen.findByTestId(`search-place-${C3}`);
    api.failNext(500, 'disk full', /^PUT \/lagen/);
    await userEvent.click(screen.getByTestId(`search-place-${C3}`));
    await waitFor(() =>
      expect(screen.getByTestId('board-message').textContent).toMatch(/disk full/),
    );
  });
});

describe('edges', () => {
  async function pick(from: string, to: string) {
    await userEvent.selectOptions(screen.getByTestId('edge-from'), from);
    await userEvent.selectOptions(screen.getByTestId('edge-to'), to);
  }

  it('draws supports and refutes edges, reverses, retypes and deletes them (lage_save)', async () => {
    const api = createMockApi();
    await openLage(api);
    await pick(C1, C2);
    await userEvent.click(screen.getByTestId('edge-add'));
    await waitFor(() =>
      expect(lageOf(api).edges).toEqual([{ from: C1, to: C2, kind: 'supports', by: 'human' }]),
    );
    expect(puts(api)[0]!.body).toMatchObject({ version: 2 });

    await userEvent.selectOptions(screen.getByTestId('edge-kind-select'), 'refutes');
    await pick(C2, C1);
    await userEvent.click(screen.getByTestId('edge-add'));
    await waitFor(() => expect(lageOf(api).edges).toHaveLength(2));
    expect(lageOf(api).edges[1]).toMatchObject({ from: C2, to: C1, kind: 'refutes' });

    await userEvent.click(screen.getByTestId(`edge-select-${C1}>${C2}:supports`));
    await userEvent.click(screen.getByTestId('edge-reverse'));
    await waitFor(() =>
      expect(lageOf(api).edges[0]).toMatchObject({ from: C2, to: C1, kind: 'supports' }),
    );

    // Retyping it to what already exists between the same cards leaves one edge, not two.
    await userEvent.click(screen.getByTestId(`edge-select-${C2}>${C1}:supports`));
    await userEvent.selectOptions(screen.getByTestId('edge-kind-edit'), 'refutes');
    await waitFor(() =>
      expect(lageOf(api).edges).toEqual([{ from: C2, to: C1, kind: 'refutes', by: 'human' }]),
    );

    await userEvent.click(screen.getByTestId(`edge-select-${C2}>${C1}:refutes`));
    await userEvent.click(screen.getByTestId('edge-delete'));
    await waitFor(() => expect(lageOf(api).edges).toHaveLength(0));
    expect(lageOf(api).version).toBe(6);
  });

  it('offers only supports and refutes to draw', async () => {
    await openLage(createMockApi());
    const options = within(screen.getByTestId('edge-kind-select')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['supports', 'refutes']);
  });

  it('keeps edges after a reload (the server holds the state)', async () => {
    const api = createMockApi();
    const first = await openLage(api);
    await pick(C1, C2);
    await userEvent.click(screen.getByTestId('edge-add'));
    await waitFor(() => expect(lageOf(api).edges).toHaveLength(1));
    first.unmount();
    await openLage(api);
    expect(await screen.findByTestId(`edge-row-${C1}>${C2}:supports`)).toBeTruthy();
    expect(screen.getByTestId('board-version').textContent).toBe('2');
  });
});

describe('proposals (polling, ADR-0032)', () => {
  it('shows an agent proposal without reload, with author, kind and summary; accept refreshes the board', async () => {
    const api = createMockApi();
    await openLage(api);
    expect(screen.getByTestId('proposals-count').textContent).toBe('0 pending');
    const p = api.addProposal({
      author: 'agent:scout',
      kind: 'place_card',
      rationale: 'Port traffic backs the claim',
      payload: { lageId: LAGE_ID, cardId: C3, x: 560, y: 0 },
    });
    await screen.findByTestId(`proposal-${p.id}`);
    expect(screen.getByTestId(`proposal-author-${p.id}`).textContent).toBe('agent:scout');
    expect(screen.getByTestId(`proposal-kind-${p.id}`).textContent).toBe('place_card');
    await waitFor(() =>
      expect(screen.getByTestId(`proposal-summary-${p.id}`).textContent).toBe(
        'Place "My observation at the port" at (560, 0)',
      ),
    );
    expect(screen.getByTestId('proposals-count').textContent).toBe('1 pending');
    // Nothing counts before a human accepts it.
    expect(screen.queryByTestId(`card-node-${C3}`)).toBeNull();

    await userEvent.click(screen.getByTestId(`proposal-accept-${p.id}`));
    await screen.findByTestId(`card-node-${C3}`);
    expect(
      api.calls.some((c) => c.method === 'POST' && c.path === `/proposals/${p.id}/accept`),
    ).toBe(true);
    expect(screen.getByTestId('proposals-count').textContent).toBe('0 pending');
    expect(screen.getByTestId(`proposal-${p.id}`).dataset['status']).toBe('accepted');
  });

  it('rejects a proposal and leaves the board unchanged', async () => {
    const api = createMockApi();
    await openLage(api);
    const p = api.addProposal({
      author: 'agent:scout',
      kind: 'create_card',
      payload: {
        lageId: LAGE_ID,
        card: { format: 2, type: 'note', title: 'Tanker tracker note', layer: 'evidenced' },
      },
    });
    const row = await screen.findByTestId(`proposal-${p.id}`);
    expect(within(row).getByTestId(`proposal-summary-${p.id}`).textContent).toBe(
      'Create card "Tanker tracker note" (evidenced)',
    );
    await userEvent.click(screen.getByTestId(`proposal-reject-${p.id}`));
    await waitFor(() =>
      expect(screen.getByTestId(`proposal-${p.id}`).dataset['status']).toBe('rejected'),
    );
    expect(lageOf(api).version).toBe(1);
  });

  it('shows a refused decision (409) and keeps the proposal pending', async () => {
    const api = createMockApi();
    await openLage(api);
    const p = api.addProposal({
      author: 'agent:scout',
      kind: 'comment',
      payload: { lageId: LAGE_ID, text: 'look at this' },
    });
    await screen.findByTestId(`proposal-${p.id}`);
    api.failNext(409, 'cannot be applied', /accept$/);
    await userEvent.click(screen.getByTestId(`proposal-accept-${p.id}`));
    expect((await screen.findByTestId('proposals-error')).textContent).toMatch(/cannot be applied/);
    expect(screen.getByTestId(`proposal-${p.id}`).dataset['status']).toBe('pending');
  });

  it('shows an agent text as text, never as markup', async () => {
    const api = createMockApi();
    await openLage(api);
    const p = api.addProposal({
      author: 'agent:scout',
      kind: 'comment',
      rationale: '<img src=x onerror=alert(1)>',
      payload: { lageId: LAGE_ID, text: '<b>bold</b>' },
    });
    const row = await screen.findByTestId(`proposal-${p.id}`);
    expect(row.querySelector('img, b')).toBeNull();
    expect(row.textContent).toContain('<b>bold</b>');
  });

  it('says when it cannot refresh', async () => {
    const api = createMockApi();
    await openLage(api);
    api.failNext(500, 'poll down', /^GET \/proposals/);
    expect((await screen.findByTestId('proposals-poll-error')).textContent).toMatch(/poll down/);
    await waitFor(() => expect(screen.queryByTestId('proposals-poll-error')).toBeNull());
  });
});

describe('disclosure', () => {
  const lageWithPrivate = () =>
    createMockApi({
      lage: makeLage({ cards: [C1, C2, C3].map((id, i) => ({ id, x: i * 280, y: 0 })) }),
    });

  it('cloud: previews what the gate clears, lists the denied private card, needs confirmation, then releases', async () => {
    const api = lageWithPrivate();
    await openLage(api);
    await userEvent.selectOptions(screen.getByTestId('context-target'), 'cloud_model');
    expect(screen.getByTestId('context-cloud-warning').textContent).toMatch(/outside this device/);
    await userEvent.click(screen.getByTestId('context-run'));
    await screen.findByTestId('context-preview');
    expect(screen.getByTestId(`context-send-${C1}`)).toBeTruthy();
    expect(screen.getByTestId(`context-send-${C2}`)).toBeTruthy();
    expect(screen.queryByTestId(`context-send-${C3}`)).toBeNull();
    expect(screen.getByTestId(`context-denied-${C3}`).textContent).toContain(C3);
    // Nothing was released yet.
    expect(
      api.calls.some(
        (c) => c.path === '/context-packages' && (c.body as { transferId?: string }).transferId,
      ),
    ).toBe(false);

    await userEvent.click(screen.getByTestId('context-confirm'));
    const pkg = await screen.findByTestId('context-package');
    expect(pkg.dataset['target']).toBe('cloud_model');
    expect(screen.getByTestId('context-independence').textContent).toBe('2 findings · 2 origins');
    expect(screen.getByTestId('context-transfer')).toBeTruthy();
    expect(screen.queryByTestId(`context-item-${C3}`)).toBeNull();
    const send = api.calls.filter((c) => c.path === '/context-packages').at(-1)!.body as Record<
      string,
      unknown
    >;
    expect(send['confirmationToken']).toMatch(/^confirm-token/);
    expect(send['transferId']).toBeTruthy();
  });

  it('cloud: a board with only private cards is blocked and sends nothing', async () => {
    const api = createMockApi({ lage: makeLage({ cards: [{ id: C3, x: 0, y: 0 }] }) });
    await openLage_(api, C3);
    await userEvent.selectOptions(screen.getByTestId('context-target'), 'cloud_model');
    await userEvent.click(screen.getByTestId('context-run'));
    const blocked = await screen.findByTestId('context-blocked');
    expect(blocked.textContent).toMatch(/Nothing will be sent/);
    expect(screen.getByTestId(`context-denied-${C3}`)).toBeTruthy();
    expect(screen.queryByTestId('context-confirm')).toBeNull();
  });

  it('cloud: cancel leaves the transfer unconfirmed', async () => {
    const api = lageWithPrivate();
    await openLage(api);
    await userEvent.selectOptions(screen.getByTestId('context-target'), 'cloud_model');
    await userEvent.click(screen.getByTestId('context-run'));
    await userEvent.click(await screen.findByTestId('context-cancel'));
    expect(screen.queryByTestId('context-preview')).toBeNull();
    expect([...api.transfers.values()].every((t) => !t.confirmed)).toBe(true);
  });

  it('local model: shows the package the service builds, never a stance, and says whose view it is', async () => {
    const api = lageWithPrivate();
    api.stances.set(C1, {
      cardId: C1,
      position: 'believed',
      weight: 0.9,
      updatedAt: 'x',
      history: [],
    });
    await openLage(api);
    await userEvent.click(screen.getByTestId('context-run'));
    await screen.findByTestId('context-package');
    expect(screen.getByTestId('context-package-target').textContent).toBe('screen');
    expect(screen.getByTestId('context-target-note').textContent).toMatch(/screen caller/);
    const text = screen.getByTestId('context-package').textContent!;
    expect(text).not.toMatch(/believed/);
    expect(screen.getByTestId(`context-item-${C3}`)).toBeTruthy();
  });

  it('shows a service refusal', async () => {
    const api = lageWithPrivate();
    await openLage(api);
    api.failNext(403, 'not registered', /context-packages/);
    await userEvent.click(screen.getByTestId('context-run'));
    expect((await screen.findByTestId('context-error')).textContent).toMatch(/not registered/);
  });

  async function openLage_(api: MockApi, firstCard: string) {
    signedIn(api);
    await userEvent.click(await screen.findByTestId(`lage-open-${LAGE_ID}`));
    await screen.findByTestId(`card-node-${firstCard}`);
  }
});

describe('stance overlay (human-only stance_save)', () => {
  it('sets the own stance on a selected card, shows it on the card and keeps it after reload', async () => {
    const api = createMockApi();
    const first = await openLage(api);
    expect(screen.getByTestId('inspector-panel').textContent).toMatch(/Select a card/);
    // A plain click: jsdom has no pointer drag, which the canvas library listens for on mousedown.
    fireEvent.click(screen.getByTestId(`card-node-${C1}`));
    await waitFor(() =>
      expect(screen.getByTestId('inspector-title').textContent).toBe('Strait traffic report'),
    );
    expect(screen.getByTestId('stance-form').textContent).toMatch(/never exported or sent/);
    await userEvent.selectOptions(screen.getByTestId('stance-position'), 'believed');
    await userEvent.type(screen.getByTestId('stance-note'), 'matches what I saw');
    await userEvent.click(screen.getByTestId('stance-save'));
    await waitFor(() => expect(screen.getByTestId('stance-status').textContent).toMatch(/Saved/));
    expect((await screen.findByTestId(`card-stance-${C1}`)).textContent).toBe(
      'You: believed, weight 0.5',
    );
    const put = api.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/stance'))!;
    expect(put.path).toBe(`/cards/${C1}/stance`);
    expect(put.body).toEqual({ position: 'believed', weight: 0.5, note: 'matches what I saw' });
    // The stance is not part of the Lage that is saved.
    expect(JSON.stringify(lageOf(api))).not.toMatch(/believed/);

    first.unmount();
    await openLage(api);
    expect((await screen.findByTestId(`card-stance-${C1}`)).textContent).toBe(
      'You: believed, weight 0.5',
    );
  });

  it('shows a failed stance save', async () => {
    const api = createMockApi();
    await openLage(api);
    // A plain click: jsdom has no pointer drag, which the canvas library listens for on mousedown.
    fireEvent.click(screen.getByTestId(`card-node-${C1}`));
    await screen.findByTestId('stance-form');
    api.failNext(500, 'state dir read-only', /stance$/);
    await userEvent.click(screen.getByTestId('stance-save'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/state dir read-only/);
  });
});

describe('usage metrics panel', () => {
  it('shows each target on its own, with no data reported as not met', async () => {
    const api = createMockApi();
    signedIn(api);
    await userEvent.click(await screen.findByTestId('nav-usage'));
    expect((await screen.findByTestId('usage-value-receipt_coverage_7d')).textContent).toBe('60 %');
    expect(screen.getByTestId('usage-status-receipt_coverage_7d').textContent).toBe('not met');
    expect(screen.getByTestId('usage-accepted').textContent).toContain('3');
    expect(screen.getByTestId('usage-decisions').textContent).toBe('1 of 4');
    expect(screen.getByTestId('usage-atlas').textContent).toContain('30 h');
    expect(screen.getByTestId('usage-agent-agent:scout')).toBeTruthy();
    expect(screen.queryByText(/score|rank/i)).toBeNull();
  });

  it('asks for a given ISO week and shows the service problem', async () => {
    const api = createMockApi();
    api.usage = {
      ...api.usage,
      targets: api.usage.targets.map((t) => ({ ...t, value: null, met: false })),
      decisions: null,
    };
    signedIn(api);
    await userEvent.click(await screen.findByTestId('nav-usage'));
    expect((await screen.findByTestId('usage-value-agent_cards_7d')).textContent).toBe('no data');
    expect(screen.getByTestId('usage-decisions').textContent).toBe('no store');
    fireEvent.change(screen.getByTestId('usage-week'), { target: { value: '2026-W40' } });
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/metrics/usage?week=2026-W40')).toBe(true),
    );
    api.failNext(403, 'human only', /metrics/);
    fireEvent.change(screen.getByTestId('usage-week'), { target: { value: '2026-W39' } });
    expect((await screen.findByTestId('usage-error')).textContent).toContain('human only');
  });
});
