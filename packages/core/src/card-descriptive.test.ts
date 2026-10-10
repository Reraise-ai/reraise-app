// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { validityPeriodError, withoutPrivateRefs } from './card-descriptive.js';

describe('validityPeriodError (ADR-0048)', () => {
  it('allows either end alone, equal dates, and a later end', () => {
    expect(validityPeriodError({})).toBeUndefined();
    expect(validityPeriodError({ validFrom: '2026-01-01' })).toBeUndefined();
    expect(validityPeriodError({ validUntil: '2026-12-31' })).toBeUndefined();
    expect(
      validityPeriodError({ validFrom: '2026-06-01', validUntil: '2026-06-01' }),
    ).toBeUndefined();
    expect(
      validityPeriodError({ validFrom: '2026-01-01', validUntil: '2026-12-31' }),
    ).toBeUndefined();
  });

  it('rejects an end earlier than the start, and ignores non-dates', () => {
    expect(validityPeriodError({ validFrom: '2026-10-31', validUntil: '2026-10-01' })).toBe(
      'validUntil 2026-10-01 is earlier than validFrom 2026-10-31',
    );
    expect(validityPeriodError({ validFrom: 'yesterday', validUntil: 'today' })).toBeUndefined();
  });
});

describe('withoutPrivateRefs (ADR-0048)', () => {
  it('drops refs and leaves the input card unchanged', () => {
    const card = {
      title: 'Listing',
      language: 'es',
      refs: [{ system: 'listings', id: 'PALMA-2B-0001' }],
    };
    const out = withoutPrivateRefs(card);
    expect(out).not.toHaveProperty('refs');
    expect(out.language).toBe('es');
    expect(card.refs).toEqual([{ system: 'listings', id: 'PALMA-2B-0001' }]);
  });

  it('returns a card that has no refs as given', () => {
    const card = { title: 'Listing', language: 'es' };
    expect(withoutPrivateRefs(card)).toBe(card);
  });
});
