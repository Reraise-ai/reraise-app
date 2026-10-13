// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import type { Card, ContextPackage } from '../generated/contracts.js';
import { createLocalQuoteModel } from './local-quote.js';

const SECRET = 'Synthetic private note that must not be repeated';
const PUBLIC_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const DENIED_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1';

function card(id: string): Card {
  return {
    id,
    format: 2,
    type: 'claim',
    title: SECRET,
    body: SECRET,
    author: 'human',
  } as Card;
}

function pkg(): ContextPackage {
  return {
    id: PUBLIC_ID,
    target: 'local_model',
    worldId: PUBLIC_ID,
    createdAt: '2026-10-13T00:00:00.000Z',
    items: [
      {
        card: card(PUBLIC_ID),
        provenance: {
          uri: 'wb:00000000-0000-4000-8000-000000000001/a',
          originRoot: 'a',
          originKnown: true,
        },
        gate: { decision: 'allow', reason: 'allow rule screen-all' },
        stance: {
          cardId: PUBLIC_ID,
          position: 'rejected',
          weight: 2,
          note: SECRET,
          updatedAt: '2026-10-13T00:00:00.000Z',
          history: [],
        },
      },
    ],
    independence: { findings: 1, origins: 1 },
    pendingProposals: [],
    withheld: 1,
    denied: [{ cardId: DENIED_ID, reason: 'default deny: no allow rule matches' }],
  } as ContextPackage;
}

describe('local-quote model', () => {
  const model = createLocalQuoteModel();

  it('names only the cleared card ids, never a title, a stance or a denied id', async () => {
    const answer = await model.ask(pkg(), 'What is on the board?');
    expect(answer).toEqual({ text: `local-quote\n${PUBLIC_ID}`, proposals: [] });
    expect(answer.text).not.toContain(SECRET);
    expect(answer.text).not.toContain(DENIED_ID);
  });

  it('answers an empty question with no card ids', async () => {
    const answer = await model.ask(pkg(), '   ');
    expect(answer).toEqual({ text: 'local-quote: no question', proposals: [] });
    expect(answer.text).not.toContain(PUBLIC_ID);
  });
});
