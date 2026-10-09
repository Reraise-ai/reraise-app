// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import {
  findEmails,
  findIbans,
  findPhoneNumbers,
  isValidIban,
  personalDataKinds,
} from './personal-data.js';

// The textbook example IBAN, split so that no scanner sees it in the source (ADR-0022).
const IBAN = ['DE89', '3704', '0044', '0532', '0130', '00'].join('');

describe('personal data patterns (ADR-0022, ADR-0042)', () => {
  it('finds e-mail addresses with their domains, example domains included', () => {
    expect(findEmails('ask jane.doe@example.org or x@y')).toEqual([
      { match: 'jane.doe@example.org', domain: 'example.org' },
    ]);
  });

  it('checks IBANs by country length and mod-97', () => {
    expect(isValidIban(IBAN)).toBe(true);
    expect(isValidIban(`${IBAN.slice(0, -1)}1`)).toBe(false);
    expect(findIbans(`pay into ${IBAN} today`)).toEqual([IBAN]);
  });

  it.each([
    ['+49 151 23456789', true],
    ['+1 (555) 010-0199', true],
    ['call +44.20.7946.0018 tonight', true],
    ['phone: 030 1234567', true],
    ['tel 555-0100', true],
    ['tel 12345', false],
    ['version +1.2.3', false],
    ['meeting at 10:30 on 2026-10-05', false],
    ['+12', false],
  ])('%s -> %s', (text, found) => {
    expect(findPhoneNumbers(text).length > 0).toBe(found);
  });

  it('names the kinds found', () => {
    expect(personalDataKinds(`Mail a@example.org, IBAN ${IBAN}, phone +49 151 23456789`)).toEqual([
      'email',
      'iban',
      'phone',
    ]);
    expect(personalDataKinds('Tankers reroute before insurers react')).toEqual([]);
  });

  describe('adversarial input stays linear (CodeQL js/polynomial-redos)', () => {
    const N = 100_000;
    const inputs: Record<string, string> = {
      'percent run': '%'.repeat(N),
      'percent run then at-sign': `${'%'.repeat(N)}@`,
      'local-part characters': '._%+-a0'.repeat(Math.ceil(N / 7)),
      'many at-signs': 'a@'.repeat(N / 2),
      'long label after at-sign': `a@${'a'.repeat(N)}`,
      'dotted labels without top-level domain': `a@${'a.'.repeat(N / 2)}1`,
      'digits and spaces': '1 '.repeat(N / 2),
    };
    it.each(Object.entries(inputs))('%s completes in under 200 ms', (_name, text) => {
      const start = performance.now();
      findEmails(text);
      personalDataKinds(text);
      expect(performance.now() - start).toBeLessThan(200);
    });

    it('still finds an address behind a very long local part, and one at the end of a run', () => {
      const found = findEmails(`${'a'.repeat(500)}@example.org`);
      expect(found).toHaveLength(1);
      expect(found[0]?.domain).toBe('example.org');
      expect(findEmails(`${'%'.repeat(N)}jane@example.org`)).toHaveLength(1);
    });
  });
});
