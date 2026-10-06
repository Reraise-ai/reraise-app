// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import {
  IGNORE_MARKER,
  checkNoRealData,
  hasSyntheticMarker,
  isAllowedEmailDomain,
  isValidIban,
  scanText,
} from './check-no-real-data.mjs';
import { makeTree } from './test-helpers.mjs';

// Fixtures are assembled at runtime so this file itself never matches the patterns.
const at = '@';
const iban = ['DE89', '3704', '0044', '0532', '0130', '00'].join(' ');
const privateIp = ['192', '168', '1', '10'].join('.');

describe('scanText', () => {
  it('flags non-allow-listed emails but allows example domains', () => {
    expect(scanText(`mail jane${at}corp.de`)).toEqual([
      { line: 1, rule: 'email', match: `jane${at}corp.de` },
    ]);
    expect(scanText(`a${at}example.org b${at}host.invalid c${at}example.com`)).toEqual([]);
  });

  it('flags valid IBANs only', () => {
    expect(scanText(`iban ${iban}`).map((f) => f.rule)).toEqual(['iban']);
    expect(isValidIban(iban)).toBe(true);
    expect(scanText('DE00 1234 5678 9012 3456 78')).toEqual([]);
  });

  it('flags tax ids and passport numbers by context', () => {
    expect(scanText(['Steuer', '-ID: 12 345 678 901'].join('')).map((f) => f.rule)).toEqual([
      'tax-id',
    ]);
    expect(scanText(['pass', 'port C01X00T47'].join('')).map((f) => f.rule)).toEqual(['passport']);
    expect(scanText('build 12345678901')).toEqual([]);
  });

  it('flags private IPs and allows documentation ranges', () => {
    expect(scanText(`host ${privateIp}`).map((f) => f.rule)).toEqual(['private-ip']);
    expect(scanText('see 192.0.2.1 and 203.0.113.7 and 198.51.100.4')).toEqual([]);
  });

  it('skips lines carrying the ignore marker', () => {
    expect(scanText(`x${at}corp.de // ${IGNORE_MARKER}`)).toEqual([]);
  });

  it('does not mistake package manager pins for emails', () => {
    expect(scanText('"packageManager": "pnpm@10.28.0"')).toEqual([]);
  });

  it('reports 1-based line numbers', () => {
    expect(scanText(`ok\nok\nx${at}corp.de`)[0]?.line).toBe(3);
  });
});

describe('isAllowedEmailDomain', () => {
  it('accepts reserved domains', () => {
    expect(isAllowedEmailDomain('EXAMPLE.org')).toBe(true);
    expect(isAllowedEmailDomain('bot.invalid')).toBe(true);
    expect(isAllowedEmailDomain('gmail.com')).toBe(false);
  });
});

describe('hasSyntheticMarker', () => {
  it('requires synthetic: true in front matter', () => {
    expect(hasSyntheticMarker('---\ntitle: x\nsynthetic: true\n---\nbody')).toBe(true);
    expect(hasSyntheticMarker('---\ntitle: x\n---\nsynthetic: true')).toBe(false);
    expect(hasSyntheticMarker('no front matter')).toBe(false);
  });
});

describe('checkNoRealData', () => {
  it('passes a clean tree and enforces the synthetic marker under examples', () => {
    const clean = makeTree({
      'README.md': `contact you${at}example.org\n`,
      'examples/hormuz/README.md': 'readme need not be marked\n',
      'examples/hormuz/card.md': '---\nsynthetic: true\n---\ntext\n',
    });
    expect(checkNoRealData(clean)).toEqual([]);

    const dirty = makeTree({
      'src/a.ts': `// ${privateIp}\n`,
      'examples/hormuz/card.md': '---\ntitle: x\n---\ntext\n',
    });
    const problems = checkNoRealData(dirty);
    expect(problems).toContain(`src/a.ts:1: private-ip: ${privateIp}`);
    expect(problems.some((p) => p.startsWith('examples/hormuz/card.md:1: not-synthetic'))).toBe(
      true,
    );
  });
});
