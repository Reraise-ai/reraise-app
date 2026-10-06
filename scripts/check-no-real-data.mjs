// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix, walk } from './lib.mjs';

/** Domains whose addresses are safe in documentation and fixtures. */
export const ALLOWED_EMAIL_DOMAINS = [
  'example.org',
  'example.com',
  'example.net',
  'users.noreply.github.com',
];
const ALLOWED_EMAIL_SUFFIXES = ['.invalid', '.test', '.example', '.localhost'];

const SKIP_FILES = new Set(['pnpm-lock.yaml']);
const SKIP_PREFIXES = ['LICENSES/'];
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.pdf']);

/**
 * Lines containing this marker are skipped, but only in files under scripts/
 * (pattern definitions and detector tests). Everywhere else it has no effect.
 */
export const IGNORE_MARKER = 'no-real-data-ignore';

const SEP = String.raw`[\s\u00a0-]`;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const TAX_ID_KEYWORD_RE =
  /(?:steuer-?id|steueridentifikationsnummer|idnr|tax[ -]?id)\W{0,12}(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/gi; // no-real-data-ignore
const TAX_ID_BARE_RE = /(?<![\d/])\d{11}(?![\d/])/g;
const STEUERNUMMER_STRICT_RE = /(?<![\d/])\d{2}\/\d{3}\/\d{3}\/\d{3}(?![\d/])/g;
const STEUERNUMMER_STRUCT_RE = /(?<![\d/])\d{2,3}\/\d{3}\/\d{4,5}(?![\d/])/g;
const STEUERNUMMER_KEYWORD_RE = /steuernummer\W{0,12}(\d{2,3}\/\d{3}\/\d{3,5})/gi; // no-real-data-ignore
const PASSPORT_RE =
  /(?:passport|reisepass)(?:[\s-]*(?:no\.?|nr\.?|number|nummer))?[\s:#.-]{0,12}((?=[A-Z0-9]*\d)[A-Z0-9]{9})\b/gi; // no-real-data-ignore
const PRIVATE_IP_RE =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;

/** ISO 13616 mod-97 check on an already normalised (upper case, no separators) string. */
function mod97(s) {
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

/** ISO 13616 IBAN lengths for SEPA and other major countries (country code -> total length). */
export const IBAN_LENGTHS = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
};

const SEPARATOR_RE = /[\s\u00a0-]/;

/**
 * Normalises case and separators (space, NBSP, dash), then requires a known country code,
 * that country's exact IBAN length and a valid mod-97 checksum.
 */
export function isValidIban(raw) {
  const s = raw.replace(/[\s\u00a0-]+/g, '').toUpperCase();
  const length = IBAN_LENGTHS[s.slice(0, 2)];
  return (
    length !== undefined && s.length === length && /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s) && mod97(s)
  );
}

/**
 * Find IBANs in one line. Matches exactly the country's length (no prefix guessing).
 * Upper-case compact or space/NBSP separated forms are flagged on their own; lower-case or
 * dash-separated forms only when the word "IBAN" appears on the same line.
 */
export function findIbans(line) {
  const found = [];
  const hasKeyword = /iban/i.test(line);
  for (const m of line.matchAll(/\b([A-Za-z]{2})\d{2}/g)) {
    const length = IBAN_LENGTHS[m[1].toUpperCase()];
    if (length === undefined) continue;
    let i = m.index;
    let chars = '';
    let relaxed = false;
    while (i < line.length && chars.length < length) {
      const c = line[i];
      if (/[A-Za-z0-9]/.test(c)) {
        chars += c;
        if (/[a-z]/.test(c)) relaxed = true;
      } else if (SEPARATOR_RE.test(c)) {
        if (c === '-') relaxed = true;
      } else break;
      i++;
    }
    if (chars.length !== length || /[A-Za-z0-9]/.test(line[i] ?? '')) continue;
    if (relaxed && !hasKeyword) continue;
    if (mod97(chars.toUpperCase())) found.push(line.slice(m.index, i));
  }
  return found;
}

/** ISO 7064 MOD 11,10 check digit for the first 10 digits of a German tax ID. */
export function taxIdCheckDigit(first10) {
  let product = 10;
  for (const ch of first10) {
    let sum = (Number(ch) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  const check = 11 - product;
  return check === 10 ? 0 : check;
}

/** Digit-structure rule plus check digit for an 11-digit German tax ID. */
export function isValidTaxId(digits) {
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  const first10 = digits.slice(0, 10);
  const counts = new Map();
  for (const d of first10) counts.set(d, (counts.get(d) ?? 0) + 1);
  const repeated = [...counts.values()].filter((n) => n > 1);
  if (repeated.length !== 1) return false;
  const times = repeated[0] ?? 0;
  if (times > 3) return false;
  if (/(\d)\1\1/.test(first10)) return false;
  return taxIdCheckDigit(first10) === Number(digits[10]);
}

export function isAllowedEmailDomain(domain) {
  const d = domain.toLowerCase();
  return (
    ALLOWED_EMAIL_DOMAINS.includes(d) ||
    ALLOWED_EMAIL_SUFFIXES.some((s) => d.endsWith(s)) ||
    d === 'localhost'
  );
}

/**
 * Scan one text. Returns { findings: [{line, rule, match}], skipped }.
 * `allowIgnore` enables the IGNORE_MARKER (only used for files under scripts/).
 */
export function scanTextDetailed(text, { allowIgnore = false } = {}) {
  const findings = [];
  let skipped = 0;
  text.split(/\r?\n/).forEach((lineText, i) => {
    if (allowIgnore && lineText.includes(IGNORE_MARKER)) {
      skipped++;
      return;
    }
    const line = i + 1;
    const add = (rule, match) => findings.push({ line, rule, match });
    for (const m of lineText.matchAll(EMAIL_RE)) {
      if (!isAllowedEmailDomain(m[1])) add('email', m[0]);
    }
    for (const match of findIbans(lineText)) add('iban', match);
    for (const m of lineText.matchAll(TAX_ID_KEYWORD_RE)) add('tax-id', m[0]);
    for (const m of lineText.matchAll(TAX_ID_BARE_RE)) {
      if (isValidTaxId(m[0])) add('tax-id', m[0]);
    }
    for (const re of [STEUERNUMMER_STRICT_RE, STEUERNUMMER_STRUCT_RE, STEUERNUMMER_KEYWORD_RE]) {
      for (const m of lineText.matchAll(re)) add('tax-number', m[0]);
    }
    for (const m of lineText.matchAll(PASSPORT_RE)) add('passport', m[0]);
    for (const m of lineText.matchAll(PRIVATE_IP_RE)) add('private-ip', m[0]);
  });
  return { findings, skipped };
}

export function scanText(text, options) {
  return scanTextDetailed(text, options).findings;
}

/** Example data files must declare `synthetic: true` (front matter, YAML top level or JSON key). */
export function hasSyntheticMarker(text, ext = '.md') {
  if (ext === '.json') {
    try {
      const data = JSON.parse(text);
      return data !== null && typeof data === 'object' && data.synthetic === true;
    } catch {
      return false;
    }
  }
  if (ext === '.yml' || ext === '.yaml') {
    return /^synthetic:\s*true\s*(#.*)?$/m.test(text);
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m !== null && /^synthetic:\s*true\s*$/m.test(m[1] ?? '');
}

function isExampleDataFile(rel) {
  return (
    rel.startsWith('examples/') && /\.(md|ya?ml|json)$/.test(rel) && !/(^|\/)README\.md$/.test(rel)
  );
}

/** Check a repo tree. Problems have the form `file:line: rule: match`. */
export function checkNoRealDataDetailed(repoRoot) {
  const problems = [];
  let skipped = 0;
  const files = existsSync(repoRoot) ? walk(repoRoot) : [];
  for (const file of files) {
    const rel = toPosix(path.relative(repoRoot, file));
    if (SKIP_FILES.has(rel) || SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const ext = path.extname(file).toLowerCase();
    if (SKIP_EXT.has(ext)) continue;
    const text = readFileSync(file, 'utf8');
    const res = scanTextDetailed(text, { allowIgnore: rel.startsWith('scripts/') });
    skipped += res.skipped;
    for (const f of res.findings) problems.push(`${rel}:${f.line}: ${f.rule}: ${f.match}`);
    if (isExampleDataFile(rel) && !hasSyntheticMarker(text, ext)) {
      problems.push(`${rel}:1: not-synthetic: example file lacks a top-level "synthetic: true"`);
    }
  }
  return { problems, skipped };
}

export function checkNoRealData(repoRoot) {
  return checkNoRealDataDetailed(repoRoot).problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { problems, skipped } = checkNoRealDataDetailed(repoRoot);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\ncheck:no-real-data failed: ${problems.length} finding(s)`);
    process.exit(1);
  }
  console.log(
    `check:no-real-data ok (${skipped} line(s) skipped via ${IGNORE_MARKER} in scripts/)`,
  );
}
