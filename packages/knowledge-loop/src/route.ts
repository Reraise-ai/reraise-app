// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// memory_route (ADR-0042): ordered deterministic rules decide whether an agent memory item is
// a card proposal or an ephemeral operational fact. Pure; the item is never stored. The result
// names signal ids, never the matched words.

import { isPublicSourceUri, personalDataKinds } from '@worldbuilder/core';
import type { MemoryRouteRequest, MemoryRouteResult } from '@worldbuilder/core';

export const CLASSIFIER = 'rules:v4';

export type Signal = MemoryRouteResult['signals'][number];

export const TRANSIENT_WORDS: readonly string[] = [
  'today',
  'tonight',
  'yesterday',
  'this morning',
  'right now',
  'currently',
  'for now',
  'this session',
  'temporarily',
  'until restart',
  'last run',
  'retry',
  'retried',
  'restart',
  'restarted',
  'reboot',
  'rebooted',
  'timeout',
  'timed out',
  'out of memory',
  'disk full',
  'cron',
  'deployed',
  'rollback',
  'build failed',
  'exit code',
  'stack trace',
  'error code',
];

export const DURABLE_WORDS: readonly string[] = [
  'lesson',
  'learned',
  'learnt',
  'insight',
  'always',
  'never',
  'rule of thumb',
  'principle',
  'pattern',
  'prefers',
  'preference',
  'decided',
  'because',
  'implies',
  'in general',
  'tends to',
  'consistently',
];

export interface RouteOptions {
  /** Extra words per signal, for example in another language. The rule order is fixed. */
  readonly extraWords?: {
    readonly transient?: readonly string[];
    readonly durable?: readonly string[];
  };
}

/** Credential words (since rules:v2). */
export const CREDENTIAL_WORDS: readonly string[] = [
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'passphrases',
  'secret',
  'secrets',
  'secret key',
  'token',
  'tokens',
  'api key',
  'api keys',
  'apikey',
  'bearer',
  'credential',
  'credentials',
  'private key',
  'ssh key',
  'pin',
  'otp',
];
const kwPattern = (words: readonly string[]) =>
  `\\b(?:${words.map((w) => w.replace(/ /g, '[ _-]?')).join('|')})\\b`;
const KW = kwPattern(CREDENTIAL_WORDS);
/** `pin` and `token` alone are too common in prose for the "… is …" form (rules:v3). */
const KW_PROSE = kwPattern(CREDENTIAL_WORDS.filter((w) => !['pin', 'token', 'tokens'].includes(w)));
/**
 * A credential word, then up to 40 characters of the same clause, then `:` or `=`; or a
 * credential word other than bare `pin`/`token` followed by is/are/was.
 */
const CREDENTIAL_ASSIGNED = new RegExp(
  `${KW}[^\\n.;!?]{0,40}?\\s*[:=]\\s*\\S|${KW_PROSE}[^\\n.;!?]{0,40}?\\s+(?:is|are|was)\\b\\s*\\S`,
  'i',
);
/** A credential word followed in the same clause by a quoted value. */
const CREDENTIAL_QUOTED = new RegExp(`${KW}[^\\n.;!?]{0,40}?[\\s:=]["'\u201c\u2018\u00ab]`, 'i');
/**
 * A UUID within a few words after a credential word (rules:v4): a credential that happens to be
 * shaped like an identifier. Includes bare `key` and the German `Passwort` / `Schlüssel`
 * (also `Schluessel`). Longer credential words also count as the end of a compound
 * (`Zugangsschlüssel`, `apitoken`); the short ones (`pin`, `otp`, `key`) must stand alone. A
 * UUID inside a `wb:` URI is an identifier. The window may cross a full stop (safe side).
 */
const UUID_CREDENTIAL_WORDS = [
  ...CREDENTIAL_WORDS,
  'key',
  'keys',
  'passwort',
  'kennwort',
  'schlüssel',
  'schluessel',
];
const UUID_STANDALONE = new Set(['pin', 'otp', 'key', 'keys']);
const uuidWords = (standalone: boolean) =>
  UUID_CREDENTIAL_WORDS.filter((w) => UUID_STANDALONE.has(w) === standalone)
    .map((w) => w.replace(/ /g, '[ _-]?'))
    .join('|');
const UUID_SEP = '[\\s:=,.()"\'\u201c\u201e-]';
const UUID_AFTER_CREDENTIAL = new RegExp(
  `(?:(?:${uuidWords(false)})|(?<![\\p{L}\\p{N}])(?:${uuidWords(true)}))(?![\\p{L}\\p{N}])` +
    `(?:${UUID_SEP}+[\\p{L}\\p{N}]+){0,4}?${UUID_SEP}+(?<!wb:)` +
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f-])',
  'iu',
);
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
/**
 * Token-like runs (rules:v3), checked per segment: 32 or more base64/base64url characters that
 * hold upper-case and lower-case letters and digits, or at least 8 digits whatever the case.
 */
const TOKEN_RUN = /[A-Za-z0-9+/=_-]{32,}/g;
/** Canonical UUIDs and `wb:` card URIs are identifiers, not secrets. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const WB_URI = /\bwb:[0-9a-f-]{36}\/[^\s]+/gi;
/** ISO dates, also joined into lists (`2026-10-01/2026-10-08`), are dates, not tokens. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g;
/** Raw-text credentials: Slack-style webhooks, JSON Web Tokens, URLs with a password. */
const RAW_SECRETS = [
  /\bhooks\.slack\.com\/(?:services|workflows)\/\S+/i,
  // A URL with a password. The scheme is checked backwards once "://" is found (a forward scan from every
  // word boundary was quadratic on a long "a.a.a." run); the same strings match as before.
  /:\/\/(?<=\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/i,
];
const JWT_HEAD = /\beyJ[A-Za-z0-9_-]{8,}/g;
const JWT_TAIL = /\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/y;
/**
 * A JSON Web Token: three dot-separated segments, the first two starting with `eyJ`. Each head
 * match consumes its whole run, and every later start inside that run would end at the same
 * place, so the scan is linear (a single regex retried the run from every `-`).
 */
function hasJwt(raw: string): boolean {
  for (const m of raw.matchAll(JWT_HEAD)) {
    JWT_TAIL.lastIndex = m.index + m[0].length;
    if (JWT_TAIL.test(raw)) return true;
  }
  return false;
}
/** Known credential prefixes of common services, at the start of a token. */
const KNOWN_TOKEN = new RegExp(
  '(?<![A-Za-z0-9])(?:' +
    [
      'xox[abprs]-[A-Za-z0-9-]{10,}',
      'gh[pousr]_[A-Za-z0-9]{20,}',
      'github_pat_[A-Za-z0-9_]{20,}',
      'sk_live_[A-Za-z0-9]{16,}',
      'pk_live_[A-Za-z0-9]{16,}',
      'sk-[A-Za-z0-9_-]{20,}',
      '(?:AKIA|ASIA)[A-Z0-9]{16}',
      'AIza[A-Za-z0-9_-]{35}',
      'glpat-[A-Za-z0-9_-]{20,}',
      'npm_[A-Za-z0-9]{30,}',
    ].join('|') +
    ')',
);
const HEX_RUN = /(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/i;
const URL = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const LOCAL_REFERENCE = [
  /(?:^|[\s"'(=])(?:~\/|\/(?:[\w.-]+\/)+[\w.-]*|[a-z]:\\)/i, // absolute or home-relative path
  /\blocalhost\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // IPv4 literal
  /\[(?=[0-9a-f]*:)[0-9a-f:]*\]/i, // bracketed IPv6 literal (the lookahead asks for a colon)
  /\b[a-z][\w.-]{0,252}:\d{2,5}\b|(?<![\w:]):\d{2,5}\b/i, // host:port or :port (not a time)
  /\bpid(?:\s*[:#])?\s*\d+\b/i,
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Drop trailing sentence punctuation from a URL; a linear scan (a `[...]+$` regex is quadratic on a long run). */
function stripTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && '.,;:!?'.includes(url.charAt(end - 1))) end--;
  return url.slice(0, end);
}

const wordsRe = (words: readonly string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'u');

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** A hyphen- or underscore-joined slug of short parts (an article title, a compound word). */
const isSlug = (s: string) => {
  const parts = s.split(/[-_]/);
  return parts.length >= 3 && parts.every((p) => p.length <= 15);
};

/**
 * A hyphen- or underscore-joined token of short mixed parts (rules:v4): at least 8 digits overall
 * and at least two parts that mix letters and digits; with only two parts, both must mix
 * (`a1b2c3d4-e5f6g7h8`, `a1b2-c3d4-...`).
 * Natural slugs and dates have no such parts.
 */
function isMixedPartToken(segment: string): boolean {
  for (const m of segment.matchAll(/(?<![A-Za-z0-9])[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+/g)) {
    const parts = m[0].split(/[-_]/);
    const digits = (m[0].match(/\d/g) ?? []).length;
    const mixed = parts.filter((p) => /\d/.test(p) && /[A-Za-z]/.test(p)).length;
    if (digits >= 8 && mixed >= 2 && (parts.length >= 3 || mixed === parts.length)) return true;
  }
  return false;
}

/** Is one segment token-like (rules:v3)? */
function tokenLikeSegment(segment: string): boolean {
  if (isMixedPartToken(segment)) return true;
  for (const m of segment.matchAll(TOKEN_RUN)) {
    const run = m[0];
    if (isSlug(run)) continue;
    if (/[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run)) return true;
    if ((run.match(/\d/g) ?? []).length >= 8) return true;
    // No natural word runs 40 letters and digits without a separator. A long compound with a
    // digit is flagged too: the safe side (a capitalised or lower-case German compound with a digit).
    if (/[A-Za-z0-9]{40,}/.test(run) && /\d/.test(run)) return true;
  }
  return false;
}

/**
 * Token-like content. Known prefixes, webhooks, JWTs, URLs with a password and long hex runs
 * are checked on the raw text. The run rules are checked per segment: identifiers (UUIDs,
 * `wb:` URIs) and ISO dates are removed first, URLs and paths are split on `/ ? & = #`, other
 * words stay whole (a base64 key may contain `/`).
 */
function hasTokenRun(raw: string): boolean {
  if (UUID_AFTER_CREDENTIAL.test(raw)) return true;
  if (KNOWN_TOKEN.test(raw) || RAW_SECRETS.some((re) => re.test(raw)) || hasJwt(raw)) return true;
  const text = raw.replace(WB_URI, ' ').replace(UUID, ' ').replace(ISO_DATE, ' ');
  if (HEX_RUN.test(text)) return true;
  for (const word of text.split(/\s+/)) {
    const pathLike =
      /^(?:[a-z][a-z0-9+.-]*:\/\/|~?\/)/i.test(word) || /^[\w-]+\.[\w.-]+\//.test(word);
    const segments = pathLike ? word.split(/[/?&=#]/) : [word];
    if (segments.some(tokenLikeSegment)) return true;
  }
  return false;
}

/** The signals of one item (ADR-0042, table "Signals"). */
export function memorySignals(request: MemoryRouteRequest, options: RouteOptions = {}): Signal[] {
  const raw = request.text;
  const text = normalise(raw);
  const signals: Signal[] = [];
  if (
    CREDENTIAL_ASSIGNED.test(raw) ||
    CREDENTIAL_QUOTED.test(raw) ||
    PRIVATE_KEY.test(raw) ||
    hasTokenRun(raw)
  )
    signals.push('secret_like');
  if (personalDataKinds(raw).length > 0) signals.push('personal_data');
  const urls = [...raw.matchAll(URL)].map((m) => stripTrailingPunctuation(m[0]));
  if (request.source !== undefined) urls.push(request.source);
  if (urls.some((u) => isPublicSourceUri(u))) signals.push('public_source');
  const withoutUrls = raw.replace(URL, ' ');
  if (LOCAL_REFERENCE.some((re) => re.test(withoutUrls))) signals.push('local_reference');
  const transient = [...TRANSIENT_WORDS, ...(options.extraWords?.transient ?? [])];
  const durable = [...DURABLE_WORDS, ...(options.extraWords?.durable ?? [])];
  if (wordsRe(transient.map(normalise)).test(text)) signals.push('transient');
  if (wordsRe(durable.map(normalise)).test(text)) signals.push('durable');
  if (text.split(' ').filter(Boolean).length < 3) signals.push('short');
  return signals;
}

/** Classify one memory item (ADR-0042, rules `rules:v4`, first match wins). */
export function routeMemory(
  request: MemoryRouteRequest,
  options: RouteOptions = {},
): MemoryRouteResult {
  const signals = memorySignals(request, options);
  const has = (s: Signal) => signals.includes(s);
  const hint = request.kindHint;
  const decide = (
    route: MemoryRouteResult['route'],
    ruleId: MemoryRouteResult['ruleId'],
  ): MemoryRouteResult => ({ route, ruleId, signals, classifier: CLASSIFIER });

  if (has('secret_like')) return decide('ephemeral_ops_fact', 'secret');
  if (has('personal_data')) return decide('ephemeral_ops_fact', 'personal_data');
  if (has('short')) return decide('ephemeral_ops_fact', 'short');
  if (hint === 'ops') return decide('ephemeral_ops_fact', 'ops_hint');
  if (has('local_reference')) return decide('ephemeral_ops_fact', 'local_reference');
  if (has('public_source')) return decide('card_proposal', 'public_source');
  if (has('durable') && !has('transient')) return decide('card_proposal', 'durable_statement');
  if (has('transient')) return decide('ephemeral_ops_fact', 'transient');
  if (hint === 'learning' || hint === 'preference' || hint === 'decision') {
    return decide('card_proposal', 'knowledge_hint');
  }
  return decide('ephemeral_ops_fact', 'default');
}
