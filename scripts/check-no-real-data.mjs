// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEmails, findIbans } from '@worldbuilder/core';
import { toPosix, walk } from './lib.mjs';

// IBAN and e-mail patterns live in packages/core (personal-data.ts), shared with memory routing
// (ADR-0042); re-exported here for the detector tests.
export { IBAN_LENGTHS, findIbans, isValidIban } from '@worldbuilder/core';

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
    for (const { match, domain } of findEmails(lineText)) {
      if (!isAllowedEmailDomain(domain)) add('email', match);
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
