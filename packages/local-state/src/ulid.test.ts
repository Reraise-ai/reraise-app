// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { ULID_PATTERN, createUlidFactory } from './ulid.js';

describe('ulid factory', () => {
  it('mints valid, strictly increasing ids even within one millisecond', () => {
    const next = createUlidFactory({ now: () => 1_700_000_000_000 });
    const ids = Array.from({ length: 1000 }, next);
    for (const id of ids) expect(id).toMatch(ULID_PATTERN);
    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toEqual(ids);
  });

  it('sorts by time across milliseconds', () => {
    let t = 1_700_000_000_000;
    const next = createUlidFactory({ now: () => t });
    const a = next();
    t += 1;
    const b = next();
    expect(b > a).toBe(true);
  });

  it('moves to the next millisecond when the random part overflows', () => {
    const next = createUlidFactory({
      now: () => 5,
      randomBytes: () => new Uint8Array(10).fill(255),
    });
    const a = next();
    const b = next();
    expect(b > a).toBe(true);
  });

  it('survives a clock that goes backwards', () => {
    let t = 1000;
    const next = createUlidFactory({ now: () => t });
    const a = next();
    t = 500;
    expect(next() > a).toBe(true);
  });
});
