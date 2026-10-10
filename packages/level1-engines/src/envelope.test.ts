// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { level1EnvelopeFor } from './envelope.js';
import { navy, report, requestOf } from './test-fixtures.js';

describe('level1EnvelopeFor (ADR-0048)', () => {
  it('sends the released cards as they are, including refs', () => {
    const privateCard = {
      ...report,
      refs: [{ system: 'archive', id: 'CLIP-0001', url: 'https://example.org/archive/CLIP-0001' }],
    };
    const request = requestOf({ cards: [navy, privateCard] });
    const envelope = level1EnvelopeFor('jev', request, request.cards);
    expect(envelope.objects[1]).toBe(privateCard);
    expect(envelope.objects[1]?.refs).toEqual(privateCard.refs);
    expect(envelope.objects[0]).toBe(navy);
  });
});
