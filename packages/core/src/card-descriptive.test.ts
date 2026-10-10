// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { validityPeriodError } from './card-descriptive.js';

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
