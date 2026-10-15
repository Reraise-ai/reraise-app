// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The findings panel lists references and pins the one the human chooses.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Finding, FindingPinRequest } from '@worldbuilder/core';
import { ApiError, type BoardClient } from './api/client.js';
import { FindingsPanel } from './components/FindingsPanel.js';

const LAGE = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const MEMO: Finding = {
  uri: 'https://example.invalid/memo',
  connector: 'http-json',
  title: 'Tanker memo',
  retrievedAt: '2026-10-14T12:00:00.000Z',
  source: 'https://example.invalid/desk',
  snippet: 'A short snippet.',
};

function panel(findings: Finding[] | Error, onPinned = vi.fn()) {
  const pins: FindingPinRequest[] = [];
  const client = {
    findings_list: async () => {
      if (findings instanceof Error) throw findings;
      return { findings };
    },
    finding_pin: async (body: FindingPinRequest) => {
      pins.push(body);
      return { card: { id: '01ARZ3NDEKTSV4RRFFQ69G5FB1' } };
    },
  } as unknown as BoardClient;
  render(<FindingsPanel client={client} lageId={LAGE} onPinned={onPinned} />);
  return { pins, onPinned };
}

describe('findings panel', () => {
  it('says when no source reported a finding', async () => {
    panel([]);
    expect(await screen.findByTestId('findings-empty')).toBeTruthy();
    expect(screen.getByTestId('findings-note').textContent).toContain('references');
  });

  it('pins the chosen finding and reloads the board', async () => {
    const { pins, onPinned } = panel([MEMO]);
    expect((await screen.findByTestId('finding-title-0')).textContent).toBe('Tanker memo');
    fireEvent.click(screen.getByTestId('finding-pin-0'));
    await vi.waitFor(() => expect(onPinned).toHaveBeenCalledOnce());
    expect(pins).toEqual([{ connector: 'http-json', uri: MEMO.uri, lageId: LAGE }]);
  });

  it('shows a source failure and does not pin', async () => {
    const { onPinned } = panel(new ApiError(502, 'Bad gateway: a connected source did not answer'));
    expect((await screen.findByTestId('findings-error')).textContent).toContain('502');
    expect(onPinned).not.toHaveBeenCalled();
    expect(screen.queryByTestId('findings-empty')).toBeNull();
  });

  it('does not pin while the board is frozen', async () => {
    const pin = vi.fn();
    const client = {
      findings_list: async () => ({ findings: [MEMO] }),
      finding_pin: pin,
    } as unknown as BoardClient;
    render(<FindingsPanel client={client} lageId={LAGE} disabled />);
    const button = await screen.findByTestId('finding-pin-0');
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(pin).not.toHaveBeenCalled();
  });
});
