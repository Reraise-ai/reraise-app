// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, computeContentHash } from './content-hash.js';

const card = {
  format: 2 as const,
  type: 'claim',
  title: 'A claim',
  layer: 'said' as const,
  author: 'human',
  source: 'https://example.org/a',
};

describe('canonicalJson (RFC 8785)', () => {
  it('reproduces the RFC 8785 section 3.2.2 example', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units, not by code points or locale', () => {
    // U+20AC (0x20AC) sorts before U+1F600 (surrogates 0xD83D 0xDE00), and "Z" before "a".
    expect(canonicalJson({ '\u{1F600}': 1, '€': 2, a: 3, Z: 4 })).toBe(
      '{"Z":4,"a":3,"€":2,"😀":1}',
    );
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [3, { f: 4, e: 5 }] })).toBe(
      '{"a":[3,{"e":5,"f":4}],"b":{"c":2,"d":1}}',
    );
  });

  it('formats numbers like ECMAScript and rejects non-finite numbers', () => {
    expect(canonicalJson([1.0, -0, 1e21, 1e-7, 100, 0.1])).toBe('[1,0,1e+21,1e-7,100,0.1]');
    expect(() => canonicalJson(Number.NaN)).toThrow('NaN');
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow('function');
  });

  it('keeps non-ASCII text unescaped, escapes control characters, omits undefined members', () => {
    expect(canonicalJson({ t: 'Grüße\u0001', u: undefined })).toBe('{"t":"Grüße\\u0001"}');
    expect(canonicalJson([undefined])).toBe('[null]');
  });
});

describe('computeContentHash (ADR-0034)', () => {
  it('is sha256: plus the hex digest of the JCS serialisation', () => {
    const jcs = canonicalJson(card);
    const hex = createHash('sha256').update(jcs, 'utf8').digest('hex');
    expect(computeContentHash(card)).toBe(`sha256:${hex}`);
    expect(computeContentHash(card)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('pins one vector so the definition never changes silently', () => {
    expect(computeContentHash(card)).toMatchInlineSnapshot(
      `"sha256:5f059177300e2c462fbc2597881b0dc6793d009f0a6e6f92625e4f98093cbcec"`,
    );
  });

  it('ignores key order, identity, reserved and store-carried fields', () => {
    const reordered = Object.fromEntries(Object.entries(card).reverse()) as typeof card;
    const withIdentity = {
      ...card,
      id: '01M1E34QM03WVTE8T1RYS3AM18',
      externalId: 'x-14',
      uri: 'wb:45aaff12-777f-40e3-a97c-8a592e1ea4f6/x-14',
      contentHash: 'sha256:00',
      typeRaw: 'behauptung',
      rating: 3,
      carrier: 'c',
      affiliation: 'a',
    };
    expect(computeContentHash(reordered)).toBe(computeContentHash(card));
    expect(computeContentHash(withIdentity)).toBe(computeContentHash(card));
  });

  it('changes with any content change, including Unicode normalisation of the text', () => {
    expect(computeContentHash({ ...card, title: 'A claim!' })).not.toBe(computeContentHash(card));
    expect(computeContentHash({ ...card, title: 'Müller' })).not.toBe(
      computeContentHash({ ...card, title: 'Müller' }),
    );
  });
});
