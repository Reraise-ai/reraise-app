// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import {
  IGNORE_MARKER,
  checkNoRealData,
  checkNoRealDataDetailed,
  hasSyntheticMarker,
  isAllowedEmailDomain,
  isValidIban,
  isValidTaxId,
  scanText,
  taxIdCheckDigit,
} from './check-no-real-data.mjs';
import { makeTree } from './test-helpers.mjs';

// Fixtures are assembled at runtime so this file itself never matches the patterns.
const at = '@';
const ibanParts = ['DE89', '3704', '0044', '0532', '0130', '00'];
const iban = ibanParts.join(' ');
const privateIp = ['192', '168', '1', '10'].join('.');
const rules = (text, opts) => scanText(text, opts).map((f) => f.rule);
const kw = (...p) => p.join('');

describe('email', () => {
  it('flags non-allow-listed emails but allows example domains', () => {
    expect(scanText(`mail jane${at}corp.de`)).toEqual([
      { line: 1, rule: 'email', match: `jane${at}corp.de` },
    ]);
    expect(scanText(`a${at}example.org b${at}host.invalid c${at}example.com`)).toEqual([]);
  });

  it('does not mistake package manager pins for emails', () => {
    expect(scanText('"packageManager": "pnpm@10.28.0"')).toEqual([]);
  });

  it('accepts reserved domains', () => {
    expect(isAllowedEmailDomain('EXAMPLE.org')).toBe(true);
    expect(isAllowedEmailDomain('bot.invalid')).toBe(true);
    expect(isAllowedEmailDomain('gmail.com')).toBe(false);
  });
});

describe('IBAN', () => {
  it('flags valid IBANs only', () => {
    expect(rules(`iban ${iban}`)).toEqual(['iban']);
    expect(isValidIban(iban)).toBe(true);
    expect(scanText('DE00 1234 5678 9012 3456 78')).toEqual([]);
  });

  it.each([
    ['lowercase', ibanParts.join(' ').toLowerCase()],
    ['dashes', ibanParts.join('-')],
    ['double spaces', ibanParts.join('  ')],
    ['NBSP', ibanParts.join('\u00a0')],
    ['compact', ibanParts.join('')],
  ])('flags %s variants', (_name, value) => {
    expect(rules(`IBAN: ${value} please`)).toEqual(['iban']);
    expect(isValidIban(value)).toBe(true);
  });

  it('flags lowercase and dash forms only next to the IBAN keyword', () => {
    expect(rules(`pay to ${ibanParts.join('-')} please`)).toEqual([]);
    expect(rules(`pay to ${iban.toLowerCase()} please`)).toEqual([]);
  });

  it('requires a known country code and that country exact length', () => {
    expect(isValidIban(`${iban}0`)).toBe(false);
    expect(rules(`IBAN ${iban}0`)).toEqual([]);
    expect(isValidIban('ZZ89 3704 0044 0532 0130 00')).toBe(false);
    expect(rules(`${iban}12345`)).toEqual([]);
  });

  it('does not flag random UUIDs or ULIDs (seeded)', () => {
    let state = 123456789;
    const rnd = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (alphabet, n) =>
      Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    const hex = '0123456789abcdef';
    const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const uuid = () =>
      [pick(hex, 8), pick(hex, 4), pick(hex, 4), pick(hex, 4), pick(hex, 12)].join('-');
    const ids = [];
    for (let i = 0; i < 1000; i++) {
      const u = uuid();
      ids.push(i % 2 === 0 ? u : u.toUpperCase(), pick(crockford, 26));
    }
    const hits = ids.flatMap((id) => scanText(`id: ${id} / IBAN-free line ${id}`));
    expect(ids).toHaveLength(2000);
    expect(hits).toEqual([]);
  });

  it('flags an IBAN followed directly by a four-letter word', () => {
    expect(rules(`${iban} thanks`)).toEqual(['iban']);
  });
});

describe('German tax id', () => {
  const valid = kw('65432', '109861');
  const wrongCheck = kw('65432', '109862');

  it('computes the ISO 7064 MOD 11,10 check digit', () => {
    expect(taxIdCheckDigit('6543210986')).toBe(1);
    expect(isValidTaxId(valid)).toBe(true);
  });

  it('flags a bare valid 11-digit number', () => {
    expect(rules(`id ${valid} end`)).toEqual(['tax-id']);
  });

  it('does not flag 11-digit numbers failing the check or the structure rule', () => {
    expect(rules(`n ${wrongCheck}`)).toEqual([]);
    expect(isValidTaxId(kw('12345', '678901'))).toBe(false);
    expect(isValidTaxId(kw('00000', '000000'))).toBe(false);
    expect(isValidTaxId(kw('11123', '456780'))).toBe(false);
    expect(rules('ts 17000000000000')).toEqual([]);
  });

  it('flags keyword-introduced tax ids', () => {
    expect(rules(kw('Steuer', '-ID: 12 345 678 901'))).toEqual(['tax-id']);
  });

  it('detects slash Steuernummer by structure and by keyword', () => {
    expect(rules(kw('12/', '345/', '678/', '901'))).toEqual(['tax-number']);
    expect(rules(kw('nr 21/', '815/', '08150'))).toEqual(['tax-number']);
    expect(rules(kw('Steuer', 'nummer: 12/345/678'))).toEqual(['tax-number']);
    expect(rules('release 1/2/3 and 12/05/2026')).toEqual([]);
  });
});

describe('passport', () => {
  const num = 'C01X00T47';
  it.each([
    `${kw('pass', 'port')} ${num}`,
    `${kw('Pass', 'port')} No. ${num}`,
    `${kw('Pass', 'port')} number: ${num}`,
    `${kw('Reise', 'pass')}-Nr. ${num}`,
    `${kw('Reise', 'pass')} Nummer ${num}`,
    `${kw('PASS', 'PORT')} NR ${num}`,
  ])('flags %s', (text) => {
    expect(rules(text)).toEqual(['passport']);
  });

  it('does not flag ordinary words after the keyword', () => {
    expect(rules(`${kw('pass', 'port')} documentary`)).toEqual([]);
    expect(rules(`${kw('pass', 'port')} management`)).toEqual([]);
  });
});

describe('private IP', () => {
  it('flags private IPs and allows documentation ranges', () => {
    expect(rules(`host ${privateIp}`)).toEqual(['private-ip']);
    expect(scanText('see 192.0.2.1 and 203.0.113.7 and 198.51.100.4')).toEqual([]);
  });
});

describe('ignore marker', () => {
  it('is honoured only when allowed', () => {
    const line = `x${at}corp.de // ${IGNORE_MARKER}`;
    expect(scanText(line, { allowIgnore: true })).toEqual([]);
    expect(rules(line)).toEqual(['email']);
  });

  it('reports 1-based line numbers', () => {
    expect(scanText(`ok\nok\nx${at}corp.de`)[0]?.line).toBe(3);
  });
});

describe('hasSyntheticMarker', () => {
  it('requires synthetic: true in markdown front matter', () => {
    expect(hasSyntheticMarker('---\ntitle: x\nsynthetic: true\n---\nbody')).toBe(true);
    expect(hasSyntheticMarker('---\ntitle: x\n---\nsynthetic: true')).toBe(false);
    expect(hasSyntheticMarker('no front matter')).toBe(false);
  });

  it('checks JSON top-level key', () => {
    expect(hasSyntheticMarker('{"synthetic": true, "a": 1}', '.json')).toBe(true);
    expect(hasSyntheticMarker('{"synthetic": "yes"}', '.json')).toBe(false);
    expect(hasSyntheticMarker('{"a": {"synthetic": true}}', '.json')).toBe(false);
    expect(hasSyntheticMarker('not json', '.json')).toBe(false);
  });

  it('checks YAML top-level key', () => {
    expect(hasSyntheticMarker('synthetic: true\nname: x\n', '.yml')).toBe(true);
    expect(hasSyntheticMarker('name: x\n  synthetic: true\n', '.yaml')).toBe(false);
    expect(hasSyntheticMarker('name: x\n', '.yml')).toBe(false);
  });
});

describe('checkNoRealData', () => {
  it('passes a clean tree and enforces the synthetic marker under examples', () => {
    const clean = makeTree({
      'README.md': `contact you${at}example.org\n`,
      'examples/hormuz/README.md': 'readme need not be marked\n',
      'examples/hormuz/card.md': '---\nsynthetic: true\n---\ntext\n',
      'examples/hormuz/data.json': '{"synthetic": true}',
      'examples/hormuz/world.yml': 'synthetic: true\n',
    });
    expect(checkNoRealData(clean)).toEqual([]);

    const dirty = makeTree({
      'src/a.ts': `// ${privateIp}\n`,
      'examples/hormuz/card.md': '---\ntitle: x\n---\ntext\n',
      'examples/hormuz/data.json': '{"a": 1}',
      'examples/hormuz/world.yaml': 'name: x\n',
    });
    const problems = checkNoRealData(dirty);
    expect(problems).toContain(`src/a.ts:1: private-ip: ${privateIp}`);
    for (const f of ['card.md', 'data.json', 'world.yaml']) {
      expect(problems.some((p) => p.startsWith(`examples/hormuz/${f}:1: not-synthetic`))).toBe(
        true,
      );
    }
  });

  it.each(['docs', 'prototype', '.claude'])('reports findings under %s/', (dir) => {
    const root = makeTree({ [`${dir}/note.md`]: `reach me at jane${at}corp.de\n` });
    expect(checkNoRealData(root)).toEqual([`${dir}/note.md:1: email: jane${at}corp.de`]);
  });

  it('honours the ignore marker only under scripts/ and counts skipped lines', () => {
    const line = `x${at}corp.de // ${IGNORE_MARKER}\n`;
    const root = makeTree({ 'scripts/a.mjs': line, 'src/b.ts': line });
    const { problems, skipped } = checkNoRealDataDetailed(root);
    expect(skipped).toBe(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('src/b.ts:1');
  });
});
