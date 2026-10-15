// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The training export panel: a preview shows the envelope, confirm downloads JSONL of
// opted-in traces, and cancel sends nothing.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Card, DisclosureTransfer, TrainingExportResult } from '@worldbuilder/core';
import type { BoardClient } from './api/client.js';
import { TrainingExportPanel } from './components/TrainingExportPanel.js';

const CARD = {
  format: 2,
  id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  type: 'claim',
  title: 'Synthetic public claim',
  training: true,
} as Card;

const transfer: DisclosureTransfer = {
  transferId: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  purpose: 'export',
  cardIds: [CARD.id!],
  payloadHash: `sha256:${'ab'.repeat(32)}`,
  preview: {
    target: 'cloud_model',
    connectorId: 'training-export',
    request: {},
    objects: [CARD],
  },
  createdAt: '2026-02-01T00:00:00.000Z',
  expiresAt: '2026-02-01T00:05:00.000Z',
  requestedBy: 'board',
};

function panel(answer: (body: { transferId?: string }) => Promise<TrainingExportResult>) {
  const calls: { transferId?: string }[] = [];
  const confirms: string[] = [];
  const client = {
    training_export: async (body: { transferId?: string } = {}) => {
      calls.push(body);
      return answer(body);
    },
    disclosure_confirm: async (id: string) => {
      confirms.push(id);
      return { token: 't'.repeat(22) };
    },
  } as unknown as BoardClient;
  render(<TrainingExportPanel client={client} />);
  return { calls, confirms };
}

describe('training export panel', () => {
  it('shows nothing to export', async () => {
    panel(async () => ({ status: 'nothing_to_export' }));
    fireEvent.click(screen.getByTestId('export-preview'));
    expect((await screen.findByTestId('export-note')).textContent).toMatch(/No opted-in decision/);
    expect(screen.queryByTestId('export-preview-envelope')).toBeNull();
  });

  it('shows the envelope and downloads JSONL after confirm', async () => {
    const { calls, confirms } = panel(async (body) =>
      body.transferId
        ? { status: 'exported', jsonl: '{"outcome":"It held."}\n', traces: 1 }
        : { status: 'confirmation_required', transfer },
    );
    fireEvent.click(screen.getByTestId('export-preview'));
    expect(await screen.findByTestId('export-preview-envelope')).toBeTruthy();
    expect(screen.getByTestId('export-envelope-connector').textContent).toBe('training-export');
    expect(screen.getByTestId(`export-send-${CARD.id}`).textContent).toMatch(
      /Synthetic public claim/,
    );
    fireEvent.click(screen.getByTestId('export-confirm'));
    expect((await screen.findByTestId('export-jsonl')).textContent).toBe(
      '{"outcome":"It held."}\n',
    );
    expect(screen.getByTestId('export-download').getAttribute('download')).toBe(
      'training-export.jsonl',
    );
    expect(confirms).toEqual([transfer.transferId]);
    expect(calls[1]).toEqual({
      transferId: transfer.transferId,
      confirmationToken: 't'.repeat(22),
    });
  });

  it('cancel hides the envelope and does not confirm', async () => {
    const { confirms } = panel(async () => ({ status: 'confirmation_required', transfer }));
    fireEvent.click(screen.getByTestId('export-preview'));
    expect(await screen.findByTestId('export-preview-envelope')).toBeTruthy();
    fireEvent.click(screen.getByTestId('export-cancel'));
    expect(screen.queryByTestId('export-preview-envelope')).toBeNull();
    expect(confirms).toEqual([]);
  });
});
