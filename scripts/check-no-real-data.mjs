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
const SKIP_PREFIXES = ['LICENSES/', 'prototype/', 'docs/', '.claude/'];
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.pdf']);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const TAX_ID_RE =
  /(?:steuer-?id|steueridentifikationsnummer|idnr|tax[ -]?id)\W{0,12}(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/gi;
// Lines containing this marker are skipped (for pattern definitions and detector tests).
export const IGNORE_MARKER = 'no-real-data-ignore';
const PASSPORT_RE = /(?:passport|reisepass)\W{0,12}([A-Z0-9]{9})\b/gi; // no-real-data-ignore
const PRIVATE_IP_RE =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;

/** ISO 13616 mod-97 check; keeps plain look-alike strings from being flagged. */
export function isValidIban(raw) {
  const s = raw.replace(/\s+/g, '');
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

export function isAllowedEmailDomain(domain) {
  const d = domain.toLowerCase();
  return (
    ALLOWED_EMAIL_DOMAINS.includes(d) ||
    ALLOWED_EMAIL_SUFFIXES.some((s) => d.endsWith(s)) ||
    d === 'localhost'
  );
}

/** Scan one text; returns [{line, rule, match}]. */
export function scanText(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    if (lineText.includes(IGNORE_MARKER)) return;
    const line = i + 1;
    for (const m of lineText.matchAll(EMAIL_RE)) {
      if (!isAllowedEmailDomain(m[1])) findings.push({ line, rule: 'email', match: m[0] });
    }
    for (const m of lineText.matchAll(IBAN_RE)) {
      if (isValidIban(m[0])) findings.push({ line, rule: 'iban', match: m[0] });
    }
    for (const m of lineText.matchAll(TAX_ID_RE))
      findings.push({ line, rule: 'tax-id', match: m[0] });
    for (const m of lineText.matchAll(PASSPORT_RE)) {
      findings.push({ line, rule: 'passport', match: m[0] });
    }
    for (const m of lineText.matchAll(PRIVATE_IP_RE)) {
      findings.push({ line, rule: 'private-ip', match: m[0] });
    }
  });
  return findings;
}

/** Example data files must declare `synthetic: true` in their front matter. */
export function hasSyntheticMarker(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m !== null && /^synthetic:\s*true\s*$/m.test(m[1]);
}

function isExampleDataFile(rel) {
  return (
    rel.startsWith('examples/') && /\.(md|ya?ml|json)$/.test(rel) && !/(^|\/)README\.md$/.test(rel)
  );
}

/** Check a repo tree. Returns problem strings of the form `file:line: rule: match`. */
export function checkNoRealData(repoRoot) {
  const problems = [];
  const files = existsSync(repoRoot) ? walk(repoRoot) : [];
  for (const file of files) {
    const rel = toPosix(path.relative(repoRoot, file));
    if (SKIP_FILES.has(rel) || SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    if (SKIP_EXT.has(path.extname(file).toLowerCase())) continue;
    const text = readFileSync(file, 'utf8');
    for (const f of scanText(text)) problems.push(`${rel}:${f.line}: ${f.rule}: ${f.match}`);
    if (isExampleDataFile(rel) && /\.md$/.test(rel) && !hasSyntheticMarker(text)) {
      problems.push(`${rel}:1: not-synthetic: example file lacks "synthetic: true" front matter`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkNoRealData(repoRoot);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\ncheck:no-real-data failed: ${problems.length} finding(s)`);
    process.exit(1);
  }
  console.log('check:no-real-data ok');
}
