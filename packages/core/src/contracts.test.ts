// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Compile-time checks of the generated contract types (typecheck fails if they drift).

import { describe, expect, it } from 'vitest';
import type { Card, CardDraft, Layer, Proposal, RuleResult } from './index.js';

const card: Card = {
  id: '01M1E34QM03WVTE8T1RYS3AM18',
  externalId: '01M1E34QM03WVTE8T1RYS3AM18',
  uri: 'wb:45aaff12-777f-40e3-a97c-8a592e1ea4f6/01M1E34QM03WVTE8T1RYS3AM18',
  format: 2,
  type: 'claim',
  title: 'A claim',
  layer: 'said',
  author: 'human',
  source: 'https://example.org/a',
  contentHash: 'sha256:5f059177300e2c462fbc2597881b0dc6793d009f0a6e6f92625e4f98093cbcec',
};

const proposal: Proposal = {
  id: '01M1FFRYR0CNCMTND011BG5QPC',
  author: 'agent:research-helper',
  kind: 'place_card',
  payload: { lageId: card.id, cardId: card.id, x: 1, y: 2 },
  status: 'pending',
  createdAt: '2026-09-16T10:05:00Z',
};

describe('generated contract types', () => {
  it('describe cards and proposals', () => {
    expect(card.layer).toBe('said');
    expect(proposal.kind).toBe('place_card');
  });

  it('reject what the contracts forbid', () => {
    // @ts-expect-error believed is a stance, never a layer
    const believed: Layer = 'believed';
    // @ts-expect-error level is reserved
    const tiered: Card = { ...card, level: 'gold' };
    // @ts-expect-error a draft never carries an author; the server sets it
    const spoofed: CardDraft = { format: 2, type: 'claim', title: 'x', author: 'human' };
    const result: RuleResult = {
      ruleId: card.id,
      fired: true,
      triggeringCardIds: [],
      unmet: [],
      unknown: [],
    };
    // @ts-expect-error a rule result has no percentage
    const scored: RuleResult = { ...result, percentage: 69 };
    expect([believed, tiered, spoofed, scored]).toHaveLength(4);
  });
});
