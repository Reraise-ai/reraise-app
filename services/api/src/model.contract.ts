// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The model_ask contract check. Imported by contract.test.ts so expectContract marks the
// operation in that Vitest isolate.

import type { ModelAskResult, Proposal } from '@worldbuilder/core';
import { expect } from 'vitest';
import { expectContract, type Fixture } from './test-helpers.js';

/** Ollama answers and the answer is a pending comment proposal. */
export async function proveModelContract(f: Fixture): Promise<void> {
  const res = await f.human('POST', `/lagen/${f.ids.lage}/model`, {
    engine: 'ollama',
    question: 'What is claimed?',
  });
  expectContract('model_ask', res, 200);
  const body = res.json() as ModelAskResult;
  expect(body.status).toBe('proposed');
  expect(body.engine).toBe('ollama');
  if (body.status !== 'proposed') return;
  expect(body.proposal.author).toBe('agent:ollama');
  expect(body.proposal.kind).toBe('comment');
  expect(body.proposal.status).toBe('pending');
  expect(body.proposal.payload).toMatchObject({
    text: 'Synthetic local answer.',
    lageId: f.ids.lage,
  });

  const listed = await f.human('GET', `/proposals?lageId=${f.ids.lage}`);
  expectContract('proposal_list', listed, 200);
  const proposals = (listed.json() as { proposals: Proposal[] }).proposals;
  expect(proposals.some((p) => p.id === body.proposal.id)).toBe(true);
}
