// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Personal-data patterns shared by the repository's "no real data" check
// (scripts/check-no-real-data.mjs, ADR-0022) and memory routing (ADR-0042): e-mail addresses,
// IBANs (ISO 13616 with mod-97) and phone numbers. Pure; one definition for both uses.

/**
 * An e-mail address; group 1 is the domain. The local part is capped at 64 characters (RFC 5321
 * section 4.5.3.1.1), so a scan that finds no "@" costs at most 64 steps per start position and the
 * whole match is linear in the input (an unbounded `+` here was quadratic on long runs of local-part
 * characters such as "%"). A longer run is still detected through its last 64 characters.
 */
export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]{1,64}@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;

/** E-mail addresses in `text`, with their domains. */
export function findEmails(text: string): { readonly match: string; readonly domain: string }[] {
  return [...text.matchAll(EMAIL_PATTERN)].map((m) => ({ match: m[0], domain: m[1] ?? '' }));
}

/** ISO 13616 mod-97 check on an already normalised (upper case, no separators) string. */
function mod97(s: string): boolean {
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
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
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
export function isValidIban(raw: string): boolean {
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
export function findIbans(line: string): string[] {
  const found: string[] = [];
  const hasKeyword = /iban/i.test(line);
  for (const m of line.matchAll(/\b([A-Za-z]{2})\d{2}/g)) {
    const length = IBAN_LENGTHS[(m[1] ?? '').toUpperCase()];
    if (length === undefined) continue;
    let i = m.index ?? 0;
    let chars = '';
    let relaxed = false;
    while (i < line.length && chars.length < length) {
      const c = line[i] ?? '';
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

const PHONE_INTERNATIONAL = /(?<![\w+])\+\d{1,3}(?:[ \u00a0./-]?\(?\d{1,5}\)?){2,6}(?!\d)/g;
const PHONE_KEYWORD =
  /\b(?:phone|tel|telephone|mobile|cell|fax|whatsapp)\b\D{0,12}(\(?\d[\d \u00a0./()-]{5,20}\d)/gi;
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;

/**
 * Phone numbers in `text`: an international number (`+` and 8 to 15 digits, with spaces, dots,
 * dashes, slashes or brackets between groups), or 7 to 15 digits right after a phone keyword.
 */
export function findPhoneNumbers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(PHONE_INTERNATIONAL)) {
    const n = digitCount(m[0]);
    if (n >= 8 && n <= 15) found.push(m[0]);
  }
  for (const m of text.matchAll(PHONE_KEYWORD)) {
    const n = digitCount(m[1] ?? '');
    if (n >= 7 && n <= 15) found.push(m[1] ?? '');
  }
  return found;
}

export type PersonalDataKind = 'email' | 'iban' | 'phone';

/** The kinds of personal data in `text` (every e-mail address counts, also example domains). */
export function personalDataKinds(text: string): PersonalDataKind[] {
  const kinds: PersonalDataKind[] = [];
  if (findEmails(text).length > 0) kinds.push('email');
  if (text.split(/\r?\n/).some((line) => findIbans(line).length > 0)) kinds.push('iban');
  if (findPhoneNumbers(text).length > 0) kinds.push('phone');
  return kinds;
}
