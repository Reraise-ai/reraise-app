// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The training_export contract check. Imported by contract.test.ts so expectContract marks
// the operation in that Vitest isolate.

import type { Card, TrainingExportResult } from '@worldbuilder/core';
import { expect } from 'vitest';
import { expectContract, type Fixture } from './test-helpers.js';

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

/** No opted-in known outcome: nothing to export. */
export async function proveTrainingExportContract(f: Fixture): Promise<void> {
  const empty = await f.human('POST', '/training/export', {});
  expectContract('training_export', empty, 200);
  expect(empty.json()).toEqual({ status: 'nothing_to_export' });

  const pub = (await f.adapter.read(f.ids.evPublic)) as Card;
  await f.adapter.patch(f.ids.evPublic, { training: true }, { contentHash: pub.contentHash });
  const created = await f.human('POST', '/decisions', {
    format: 2,
    type: 'decision',
    title: 'Synthetic training decision',
    visibility: 'public',
    training: true,
    worlds: [f.worldId],
    sections: sections([f.ids.evPublic], 'It held.'),
  });
  expect(created.statusCode).toBe(201);

  const preview = await f.human('POST', '/training/export', {});
  expectContract('training_export', preview, 200);
  const body = preview.json() as TrainingExportResult;
  expect(body.status).toBe('confirmation_required');
  expect(body.transfer?.purpose).toBe('export');
  expect(body.transfer?.preview.connectorId).toBe('training-export');
}
