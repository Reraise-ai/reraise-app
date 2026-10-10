// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { level1EnvelopeFor } from './envelope.js';
import { navy, report, requestOf } from './test-fixtures.js';

describe('level1EnvelopeFor (ADR-0048)', () => {
  it('omits private refs and does not change the caller card', () => {
    const privateCard = {
      ...report,
      refs: [{ system: 'archive', id: 'CLIP-0001', url: 'https://example.org/archive/CLIP-0001' }],
    };
    const request = requestOf({ cards: [navy, privateCard] });
    const envelope = level1EnvelopeFor('jev', request, request.cards);
    expect(envelope.objects[1]).not.toHaveProperty('refs');
    expect(envelope.objects[1]?.title).toBe(report.title);
    expect(privateCard.refs).toHaveLength(1);
    expect(envelope.objects[0]).toBe(navy);
  });
});
