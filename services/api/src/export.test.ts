// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// training_export: JSONL of opted-in decision traces, nothing sent until the human confirms
// that one cloud transfer. A card without training: true never appears, not even as an id.

import type { Card, DisclosureConfirmation, TrainingExportResult } from '@worldbuilder/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectContract, makeFixture, PRIVATE_TEXT, type Fixture } from './test-helpers.js';

const STANCE = 'STANCE-MARKER';

const sections = (cardsUsed: string[], outcome: string) => ({
  situation: 'A synthetic situation.',
  trigger: 'A synthetic trigger.',
  conditions: 'Synthetic conditions.',
  facts: 'Synthetic facts.',
  priorities: 'Synthetic priorities.',
  action: 'Synthetic action.',
  alternatives: 'Synthetic alternatives.',
  exclusions: 'Synthetic exclusions.',
  rationale: 'Synthetic rationale.',
  cardsUsed,
  outcome,
});

async function optIn(f: Fixture, id: string): Promise<void> {
  const card = (await f.adapter.read(id)) as Card;
  await f.adapter.patch(id, { training: true }, { contentHash: card.contentHash });
}

describe('training_export', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await makeFixture();
    await optIn(f, f.ids.evPublic);
    expectContract(
      'stance_save',
      await f.human('PUT', `/cards/${f.ids.evPublic}/stance`, {
        position: 'believed',
        weight: 1,
        note: STANCE,
      }),
      200,
    );
  });
  afterAll(async () => {
    await f.close();
  });

  it('answers nothing_to_export when no opted-in known outcome is cleared', async () => {
    const res = await f.human('POST', '/training/export', {});
    expectContract('training_export', res, 200);
    expect(res.json()).toEqual({ status: 'nothing_to_export' });
  });

  it('previews, then returns JSONL of only opted-in cards after confirmation', async () => {
    const created = await f.human('POST', '/decisions', {
      format: 2,
      type: 'decision',
      title: 'Synthetic training decision',
      visibility: 'public',
      training: true,
      worlds: [f.worldId],
      sections: sections([f.ids.evPublic, f.ids.evPrivate], 'It held.'),
    });
    expect(created.statusCode).toBe(201);
    const decision = created.json() as Card;

    const first = await f.human('POST', '/training/export', {});
    expectContract('training_export', first, 200);
    const preview = first.json() as TrainingExportResult;
    expect(preview.status).toBe('confirmation_required');
    const transfer = preview.transfer!;
    expect(transfer.purpose).toBe('export');
    expect(transfer.preview.connectorId).toBe('training-export');
    expect(transfer.cardIds).toContain(decision.id);
    expect(transfer.cardIds).toContain(f.ids.evPublic);
    expect(transfer.cardIds).not.toContain(f.ids.evPrivate);
    const sent = JSON.stringify(transfer.preview);
    expect(sent).not.toContain(PRIVATE_TEXT);
    expect(sent).not.toContain(STANCE);

    const confirmed = await f.human(
      'POST',
      `/disclosure/transfers/${transfer.transferId}/confirm`,
      { payloadHash: transfer.payloadHash },
    );
    expectContract('disclosure_confirm', confirmed, 200);
    const token = (confirmed.json() as DisclosureConfirmation).token as string;

    const exported = await f.human('POST', '/training/export', {
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    expectContract('training_export', exported, 200);
    const body = exported.json() as TrainingExportResult;
    expect(body.status).toBe('exported');
    expect(body.traces).toBe(1);
    expect(body.jsonl).toBeDefined();
    const lines = body.jsonl!.trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as {
      decision: Card;
      usedCards: Card[];
      outcome: string;
    };
    expect(record.decision.training).toBe(true);
    expect(record.decision.id).toBe(decision.id);
    expect(record.usedCards.map((c) => c.id)).toEqual([f.ids.evPublic]);
    expect(record.usedCards.every((c) => c.training === true)).toBe(true);
    expect(record.outcome).toBe('It held.');
    expect(body.jsonl).not.toContain(f.ids.evPrivate);
    expect(body.jsonl).not.toContain(PRIVATE_TEXT);
    expect(body.jsonl).not.toContain(STANCE);

    const replay = await f.human('POST', '/training/export', {
      transferId: transfer.transferId,
      confirmationToken: token,
    });
    expectContract('training_export', replay, 403);
  });

  it('refuses a token without a transfer', async () => {
    expectContract(
      'training_export',
      await f.human('POST', '/training/export', {
        confirmationToken: 'AAAAAAAAAAAAAAAAAAAAAAAA',
      }),
      400,
    );
  });
});
