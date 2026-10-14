// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The model panel: a local ask stores the comment, a cloud ask shows the envelope and sends
// only after confirmation, and cancel sends nothing.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Card, DisclosureTransfer, ModelAskRequest, ModelAskResult } from '@worldbuilder/core';
import type { BoardClient } from './api/client.js';
import { ModelAskPanel } from './components/ModelAskPanel.js';

const LAGE = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CARD = {
  format: 2,
  id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  type: 'claim',
  title: 'Synthetic public claim',
} as Card;

const transfer: DisclosureTransfer = {
  transferId: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  purpose: 'context_package',
  cardIds: [CARD.id!],
  payloadHash: `sha256:${'ab'.repeat(32)}`,
  preview: {
    target: 'cloud_model',
    connectorId: 'cloud-chat',
    request: { question: 'What is claimed?' },
    objects: [CARD],
  },
  createdAt: '2026-02-01T00:00:00.000Z',
  expiresAt: '2026-02-01T00:05:00.000Z',
  requestedBy: 'board',
};

function panel(answer: (body: ModelAskRequest) => Promise<ModelAskResult>) {
  const asks: ModelAskRequest[] = [];
  const confirms: string[] = [];
  const client = {
    model_ask: async (_id: string, body: ModelAskRequest) => {
      asks.push(body);
      return answer(body);
    },
    disclosure_confirm: async (id: string) => {
      confirms.push(id);
      return { token: 't'.repeat(22) };
    },
  } as unknown as BoardClient;
  render(<ModelAskPanel client={client} lageId={LAGE} />);
  return { asks, confirms };
}

function proposed(text: string, author: string): ModelAskResult {
  return {
    status: 'proposed',
    engine: 'ollama',
    proposal: {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
      author,
      kind: 'comment',
      payload: { text },
      status: 'pending',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  };
}

describe('model panel', () => {
  it('shows the Ollama comment and does not confirm', async () => {
    const { asks, confirms } = panel(async () =>
      proposed('Synthetic local answer.', 'agent:ollama'),
    );
    fireEvent.change(screen.getByTestId('model-question'), {
      target: { value: 'What is claimed?' },
    });
    fireEvent.click(screen.getByTestId('model-ask'));
    expect((await screen.findByTestId('model-proposal')).textContent).toBe(
      'Synthetic local answer.',
    );
    expect(screen.getByTestId('model-note').textContent).toContain('agent:ollama');
    expect(asks).toEqual([{ engine: 'ollama', question: 'What is claimed?' }]);
    expect(confirms).toEqual([]);
    expect(screen.queryByTestId('model-preview')).toBeNull();
  });

  it('sends a cloud question only after the transfer is confirmed', async () => {
    const { asks, confirms } = panel(async (body) => {
      if (!body.transferId)
        return { status: 'confirmation_required', engine: 'cloud-chat', transfer };
      return {
        ...proposed('Synthetic cloud answer.', 'agent:cloud-chat'),
        engine: 'cloud-chat',
      };
    });
    fireEvent.change(screen.getByTestId('model-engine'), { target: { value: 'cloud-chat' } });
    fireEvent.change(screen.getByTestId('model-question'), {
      target: { value: 'What is claimed?' },
    });
    fireEvent.click(screen.getByTestId('model-ask'));
    expect((await screen.findByTestId('model-send-' + CARD.id)).textContent).toContain(
      'Synthetic public claim',
    );
    expect(screen.getByTestId('model-envelope-connector').textContent).toBe('cloud-chat');
    expect(asks).toHaveLength(1);
    expect(confirms).toEqual([]);

    fireEvent.click(screen.getByTestId('model-confirm'));
    expect((await screen.findByTestId('model-proposal')).textContent).toBe(
      'Synthetic cloud answer.',
    );
    expect(confirms).toEqual([transfer.transferId]);
    expect(asks[1]).toMatchObject({
      engine: 'cloud-chat',
      question: 'What is claimed?',
      transferId: transfer.transferId,
      confirmationToken: 't'.repeat(22),
    });
    expect(screen.queryByTestId('model-preview')).toBeNull();
  });

  it('clears the preview on cancel and sends nothing', async () => {
    const { asks, confirms } = panel(async () => ({
      status: 'confirmation_required',
      engine: 'decision-stub',
      transfer,
    }));
    fireEvent.change(screen.getByTestId('model-engine'), { target: { value: 'decision-stub' } });
    fireEvent.change(screen.getByTestId('model-question'), { target: { value: 'Which option?' } });
    fireEvent.click(screen.getByTestId('model-ask'));
    await screen.findByTestId('model-preview');
    fireEvent.click(screen.getByTestId('model-cancel'));
    expect(screen.queryByTestId('model-preview')).toBeNull();
    expect(asks).toHaveLength(1);
    expect(confirms).toEqual([]);
  });

  it('says when the gate clears nothing, and shows a refusal', async () => {
    const { asks } = panel(async () => ({ status: 'nothing_cleared', engine: 'cloud-chat' }));
    fireEvent.submit(screen.getByTestId('model-form'));
    expect((await screen.findByTestId('model-error')).textContent).toBe('Write a question first.');
    expect(asks).toEqual([]);

    fireEvent.change(screen.getByTestId('model-question'), {
      target: { value: 'What is claimed?' },
    });
    fireEvent.click(screen.getByTestId('model-ask'));
    expect((await screen.findByTestId('model-note')).textContent).toBe(
      'No card on this board is cleared for that model.',
    );
  });

  it('shows a failed ask and stays quiet while disabled', async () => {
    const ask = vi.fn(async () => {
      throw new Error('the model did not answer');
    });
    const client = { model_ask: ask } as unknown as BoardClient;
    const { rerender } = render(<ModelAskPanel client={client} lageId={LAGE} />);
    fireEvent.change(screen.getByTestId('model-question'), {
      target: { value: 'What is claimed?' },
    });
    fireEvent.click(screen.getByTestId('model-ask'));
    expect((await screen.findByTestId('model-error')).textContent).toContain('the model did not answer');

    rerender(<ModelAskPanel client={client} lageId={LAGE} disabled />);
    expect((screen.getByTestId('model-ask') as HTMLButtonElement).disabled).toBe(true);
  });
});
