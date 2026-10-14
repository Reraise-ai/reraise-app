// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Source profile on the inspector (ADR-0018): each dimension shows n, and "insufficient data"
// below the minimum. No percentage and no combined figure.

import { render, screen, waitFor } from '@testing-library/react';
import type { StoredSourceProfile } from '@worldbuilder/core';
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './api/client.js';
import { InspectorPanel } from './components/InspectorPanel.js';
import { SourceProfileList } from './components/SourceProfileList.js';
import { BASE, TOKEN, makeCard } from './testing/mockApi.js';

const SOURCE = 'https://example.invalid/report-a';
const CARD = makeCard({ id: '01JA00000000000000000000C1', title: 'Wire report', source: SOURCE });

function stored(n: number, earlierN?: number): StoredSourceProfile {
  const one = (sample: number) => ({
    source: SOURCE,
    computedAt: '2026-10-14T00:00:00.000Z',
    minimumN: 5,
    dimensions: {
      hitAccuracy: sample > 0 ? { n: sample, value: 1 } : { n: 0 },
      reliability: { n: 0 },
      topicCompetence: [],
      agreement: { n: 0 },
      deviation: { n: 0 },
      sourceQuality: { n: 0 },
      historicalPerformance: { n: 0 },
      counterPerspectiveValue: { n: 0 },
    },
  });
  return {
    profile: one(n),
    earlier: earlierN === undefined ? [] : [one(earlierN)],
  };
}

describe('SourceProfileList', () => {
  it('shows eight dimensions as insufficient data, with no percentage or verdict', () => {
    render(<SourceProfileList profile={undefined} error={null} />);
    expect(screen.getAllByText(/insufficient data \(n=0\)/)).toHaveLength(8);
    expect(screen.getByTestId('source-profile').textContent).not.toMatch(
      /%|percent|verdict|\bscore\b/i,
    );
    expect(screen.queryByTestId('source-profile-earlier')).toBeNull();
  });

  it('keeps the figure hidden below the minimum and shows it once n is large enough', () => {
    const { rerender } = render(<SourceProfileList profile={stored(1)} error={null} />);
    expect(screen.getByTestId('source-dimension-hitAccuracy').textContent).toBe(
      'Hit accuracy: insufficient data (n=1)',
    );
    rerender(<SourceProfileList profile={stored(5, 1)} error={null} />);
    expect(screen.getByTestId('source-dimension-hitAccuracy').textContent).toBe(
      'Hit accuracy: 1 (n=5)',
    );
    expect(screen.getByTestId('source-profile-earlier').textContent).toBe('Earlier hit count: 1');
    expect(screen.getByTestId('source-profile').textContent).not.toMatch(/%/);
  });
});

describe('inspector source profile', () => {
  function open(status: number, body?: unknown) {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(body ?? { title: 'Not found', status }), {
          status,
          headers: {
            'content-type': status === 200 ? 'application/json' : 'application/problem+json',
          },
        }),
    );
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch });
    render(
      <InspectorPanel
        client={client}
        card={CARD}
        cardId={CARD.id}
        stance={undefined}
        onSaveStance={async () => {}}
      />,
    );
    return fetch;
  }

  it('treats a missing profile as empty dimensions', async () => {
    const fetch = open(404);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toContain(encodeURIComponent(SOURCE));
    expect(screen.getByTestId('source-dimension-hitAccuracy').textContent).toContain(
      'insufficient data (n=0)',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the stored sample size', async () => {
    open(200, stored(1));
    await waitFor(() =>
      expect(screen.getByTestId('source-dimension-hitAccuracy').textContent).toContain(
        'insufficient data (n=1)',
      ),
    );
  });

  it('shows an alert when the profile cannot be read', async () => {
    open(500, { title: 'Unavailable', status: 500 });
    await waitFor(() => expect(screen.getByTestId('source-profile-error')).toBeTruthy());
    expect(screen.queryByTestId('source-dimension-hitAccuracy')).toBeNull();
  });
});
