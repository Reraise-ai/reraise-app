// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { formatEstimate, formatEstimates } from './format.js';
import { createLocalRulesEngine } from './local-rules.js';
import { ID, fixedNow, requestOf } from './test-fixtures.js';

describe('formatEstimate', () => {
  it('writes an attributed estimate, never a verdict', () => {
    expect(
      formatEstimate({
        engine: 'local-rules',
        predictedMove: 'Keep restrictions',
        confidence: 0.82,
      }),
    ).toBe('local-rules estimates 0.82 for Keep restrictions');
    expect(formatEstimate({ engine: 'jev', predictedMove: 'Wait', confidence: 0.8 })).toBe(
      'jev estimates 0.80 for Wait',
    );
    expect(formatEstimate({ engine: 'e', predictedMove: 'M', confidence: 0 })).toBe(
      'e estimates 0.00 for M',
    );
    expect(formatEstimate({ engine: 'e', predictedMove: 'M', confidence: 1 })).toBe(
      'e estimates 1.00 for M',
    );
  });

  it('rounds to two decimals and keeps the line on one line', () => {
    expect(formatEstimate({ engine: 'e', predictedMove: 'M', confidence: 0.8249 })).toBe(
      'e estimates 0.82 for M',
    );
    expect(
      formatEstimate({ engine: 'e', predictedMove: 'Go\nnow\u0000 please', confidence: 0.5 }),
    ).toBe('e estimates 0.50 for Go now please');
  });

  it('refuses a confidence outside [0, 1] and an empty engine or move', () => {
    for (const confidence of [-0.1, 1.01, Number.NaN, Infinity])
      expect(() => formatEstimate({ engine: 'e', predictedMove: 'M', confidence })).toThrow(
        RangeError,
      );
    expect(() => formatEstimate({ engine: ' ', predictedMove: 'M', confidence: 0.5 })).toThrow(
      RangeError,
    );
    expect(() => formatEstimate({ engine: 'e', predictedMove: '', confidence: 0.5 })).toThrow(
      RangeError,
    );
  });
});

describe('formatEstimates', () => {
  it('gives one line per player of a prediction, none of them worded as a verdict', async () => {
    const p = await createLocalRulesEngine({ now: fixedNow }).predict(requestOf());
    const lines = formatEstimates(p);
    expect(lines.map((l) => l.playerCardId)).toEqual([ID.navy, ID.consortium]);
    for (const l of lines) {
      expect(l.text).toMatch(/^local-rules estimates \d\.\d\d for /);
      expect(l.text).not.toMatch(/answer|verdict|will |is the/i);
    }
    expect(lines[0]!.text).toBe('local-rules estimates 0.58 for Keep night transit restrictions');
  });
});
