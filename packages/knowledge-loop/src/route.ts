// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// memory_route (ADR-0042): ordered deterministic rules decide whether an agent memory item is
// a card proposal or an ephemeral operational fact. Pure; the item is never stored. The result
// names signal ids, never the matched words.

import { isPublicSourceUri, personalDataKinds } from '@worldbuilder/core';
import type { MemoryRouteRequest, MemoryRouteResult } from '@worldbuilder/core';

export const CLASSIFIER = 'rules:v3';

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
const KW = `\\b(?:${CREDENTIAL_WORDS.map((w) => w.replace(/ /g, '[ _-]?')).join('|')})\\b`;
/** A credential word, then up to 40 characters of the same clause, then `:`, `=`, is/are/was. */
const CREDENTIAL_ASSIGNED = new RegExp(
  `${KW}[^\\n.;!?]{0,40}?(?:\\s*[:=]|\\s+(?:is|are|was)\\b)\\s*\\S`,
  'i',
);
/** A credential word followed in the same clause by a quoted value. */
const CREDENTIAL_QUOTED = new RegExp(`${KW}[^\\n.;!?]{0,40}?[\\s:=]["'\u201c\u2018\u00ab]`, 'i');
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
/**
 * Token-like runs (rules:v3): 32 or more base64/base64url characters that hold upper-case and
 * lower-case letters and digits, or at least 8 digits whatever the case; or long hex.
 */
const TOKEN_RUN = /[A-Za-z0-9+/=_-]{32,}/g;
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
    ].join('|') +
    ')',
);
const HEX_RUN = /(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/i;
const URL = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const LOCAL_REFERENCE = [
  /(?:^|[\s"'(=])(?:~\/|\/(?:[\w.-]+\/)+[\w.-]*|[a-z]:\\)/i, // absolute or home-relative path
  /\blocalhost\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // IPv4 literal
  /\[[0-9a-f:]*:[0-9a-f:]*\]/i, // bracketed IPv6 literal
  /\b[a-z][\w.-]*:\d{2,5}\b|(?<![\w:]):\d{2,5}\b/i, // host:port or :port (not a time)
  /\bpid\s*[:#]?\s*\d+\b/i,
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsRe = (words: readonly string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'u');

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

function hasTokenRun(text: string): boolean {
  if (HEX_RUN.test(text) || KNOWN_TOKEN.test(text)) return true;
  for (const m of text.matchAll(TOKEN_RUN)) {
    if (/[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /\d/.test(m[0])) return true;
    if ((m[0].match(/\d/g) ?? []).length >= 8) return true;
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
  const urls = [...raw.matchAll(URL)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
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

/** Classify one memory item (ADR-0042, rules `rules:v3`, first match wins). */
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
