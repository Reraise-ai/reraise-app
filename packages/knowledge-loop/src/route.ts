// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// memory_route (ADR-0042): ordered deterministic rules decide whether an agent memory item is
// a card proposal or an ephemeral operational fact. Pure; the item is never stored. The result
// names signal ids, never the matched words.

import { isPublicSourceUri } from '@worldbuilder/core';
import type { MemoryRouteRequest, MemoryRouteResult } from '@worldbuilder/core';

export const CLASSIFIER = 'rules:v1';

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

const CREDENTIAL =
  /\b(?:password|passwd|secret|token|api[ _-]?key|apikey|bearer)\b\s*(?:[:=]|is\b)\s*\S+/i;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const TOKEN_RUN = /[A-Za-z0-9+=_]{32,}/g;
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
  for (const m of text.matchAll(TOKEN_RUN)) {
    if (/[A-Za-z]/.test(m[0]) && /\d/.test(m[0])) return true;
  }
  return false;
}

/** The signals of one item (ADR-0042, table "Signals"). */
export function memorySignals(request: MemoryRouteRequest, options: RouteOptions = {}): Signal[] {
  const raw = request.text;
  const text = normalise(raw);
  const signals: Signal[] = [];
  if (CREDENTIAL.test(raw) || PRIVATE_KEY.test(raw) || hasTokenRun(raw))
    signals.push('secret_like');
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

/** Classify one memory item (ADR-0042, rules `rules:v1`, first match wins). */
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
  if (has('short')) return decide('ephemeral_ops_fact', 'short');
  if (hint === 'ops') return decide('ephemeral_ops_fact', 'ops_hint');
  if (has('public_source')) return decide('card_proposal', 'public_source');
  if (has('local_reference')) return decide('ephemeral_ops_fact', 'local_reference');
  if (has('durable') && !has('transient')) return decide('card_proposal', 'durable_statement');
  if (has('transient')) return decide('ephemeral_ops_fact', 'transient');
  if (hint === 'learning' || hint === 'preference' || hint === 'decision') {
    return decide('card_proposal', 'knowledge_hint');
  }
  return decide('ephemeral_ops_fact', 'default');
}
