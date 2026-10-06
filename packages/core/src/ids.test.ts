// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildUri,
  deriveCardId,
  encodeExternalId,
  encodeUlid,
  isWbUri,
  parseUri,
  sha256,
} from './ids.js';

const STORE = '45aaff12-777f-40e3-a97c-8a592e1ea4f6';
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('buildUri', () => {
  it('builds wb:<storeInstanceId>/<externalId>', () => {
    expect(buildUri(STORE, 'x-14')).toBe(`wb:${STORE}/x-14`);
  });

  it('percent-encodes reserved characters with upper-case hex and keeps case', () => {
    expect(encodeExternalId('a b/c!*')).toBe('a%20b%2Fc%21%2A');
    expect(encodeExternalId('Aa~._-')).toBe('Aa~._-');
  });

  it('NFC-normalises before encoding', () => {
    expect(encodeExternalId('Müller')).toBe('M%C3%BCller');
    expect(buildUri(STORE, 'Müller')).toBe(buildUri(STORE, 'Müller'));
  });

  it('refuses a hostname, path or name as store instance id, and empty external ids', () => {
    expect(() => buildUri('analyst-laptop', 'x-1')).toThrow('UUID');
    expect(() => buildUri('/home/user/cards', 'x-1')).toThrow('UUID');
    expect(() => buildUri(STORE, '')).toThrow('empty');
  });
});

describe('parseUri / isWbUri', () => {
  it('round-trips external ids', () => {
    for (const externalId of ['x-14', 'a b/c', 'Müller', '01M1E34QM03WVTE8T1RYS3AM18']) {
      expect(parseUri(buildUri(STORE, externalId))).toEqual({
        storeInstanceId: STORE,
        externalId: externalId.normalize('NFC'),
      });
    }
  });

  it('rejects URIs with a host or a path', () => {
    for (const uri of [
      'wb://host/x-14',
      `wb:${STORE}/a/b`,
      'https://example.org/x',
      `wb:${STORE}/`,
    ]) {
      expect(isWbUri(uri)).toBe(false);
      expect(() => parseUri(uri)).toThrow('not a wb: card URI');
    }
  });
});

describe('sha256', () => {
  it('matches node:crypto for known and random inputs', () => {
    expect(hex(sha256(new Uint8Array()))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    for (const size of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = randomBytes(size);
      expect(hex(sha256(data))).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });
});

describe('deriveCardId', () => {
  it('takes the first 128 bits of SHA-256(uri) as a ULID', () => {
    const uri = buildUri(STORE, 'x-14');
    const id = deriveCardId(uri);
    expect(id).toMatch(ULID_RE);
    const digest = createHash('sha256').update(uri).digest();
    expect(id).toBe(encodeUlid(digest.subarray(0, 16)));
  });

  it('is stable for the same URI and differs between stores and ids', () => {
    const other = '56eb65bc-301e-4633-afb0-e1f3deff8f57';
    expect(deriveCardId(buildUri(STORE, 'x-14'))).toBe(deriveCardId(buildUri(STORE, 'x-14')));
    expect(deriveCardId(buildUri(STORE, 'x-14'))).not.toBe(deriveCardId(buildUri(other, 'x-14')));
    expect(deriveCardId(buildUri(STORE, 'x-14'))).not.toBe(deriveCardId(buildUri(STORE, 'x-15')));
  });

  it('pins one known vector so the scheme never changes silently', () => {
    expect(deriveCardId(`wb:${STORE}/x-14`)).toBe(deriveCardId(buildUri(STORE, 'x-14')));
    expect(deriveCardId(`wb:${STORE}/x-14`)).toMatchInlineSnapshot(`"3S0J4MKVSF9TAYFMMF2BCZJG9F"`);
  });

  it('refuses anything but a wb: URI', () => {
    expect(() => deriveCardId('x-14')).toThrow('not a wb: card URI');
  });
});

describe('encodeUlid', () => {
  it('encodes 0 and 2^128-1 at the edges of the ULID range', () => {
    expect(encodeUlid(new Uint8Array(16))).toBe('0'.repeat(26));
    expect(encodeUlid(new Uint8Array(16).fill(255))).toBe(`7${'Z'.repeat(25)}`);
    expect(() => encodeUlid(new Uint8Array(15))).toThrow('16 bytes');
  });
});
