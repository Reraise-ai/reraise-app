// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Origin classes and the share projection (ADR-0036). Conclusions are private: everything
// that originates from the user without a public external source never goes to other people.
// The classification is derived from canonical card fields and fails closed: whatever cannot
// be shown to rest on a public external source counts as user-originated.

import type {
  Card,
  CardContent,
  PlayerEntry,
  SharedCard,
  SharedPlayerEntry,
} from './generated/contracts.js';
import { computeContentHash } from './content-hash.js';

/**
 * `external`: rests on a public external source; shareable after the user released it.
 * `experience`: the user's own experience; private by default, shareable after the user
 * released that card. `conclusion`: any other user-originated content (decisions, rules,
 * ratings and own assessments, assumptions, Lagen, AI output, cards without a public source);
 * never shareable.
 */
export type OriginClass = 'external' | 'experience' | 'conclusion';

export interface Origin {
  readonly originClass: OriginClass;
  /** Why, for the gate's decision reason; never card content. */
  readonly reason: string;
}

/**
 * The only card types that can rest on an external source (allow-list, compared trimmed and
 * lower-cased). Every other type, known or not (decision, rule, rating, assumption, lage, any
 * open-vocabulary value), is the user's own conclusion.
 */
export const EXTERNAL_TYPES = [
  'evidence',
  'source',
  'claim',
  'event',
  'actor',
  'person',
  'organisation',
  'topic',
] as const;

/** Player fields that may go along with a shared card, entry by entry. */
export const SHARED_PLAYER_FIELDS = [
  'interests',
  'capabilities',
  'dependencies',
  'moves',
  'redLines',
  'assumedGoals',
] as const;

/** Card fields a share carries besides the player fields: content and provenance only. */
export const SHARED_FIELDS = [
  'id',
  'format',
  'collection',
  'type',
  'title',
  'body',
  'date',
  'layer',
  'source',
  'sourceDate',
  'sourceChecksum',
  'author',
] as const;

/** Special-use and private top-level labels (RFC 6761, RFC 6762, RFC 7686, RFC 8375, common use). */
const PRIVATE_TLDS = new Set([
  'localhost',
  'local',
  'internal',
  'lan',
  'corp',
  'intranet',
  'test',
  'example',
  'invalid',
  'onion',
  'arpa',
]);
/** Wildcard DNS services that resolve names embedding an IP address. */
const IP_EMBEDDING_DOMAINS = ['nip.io', 'sslip.io', 'xip.io'];
const IPV4_DOTTED = /(?:^|\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\.|$)/;
const IPV4_DASHED = /^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/;

/**
 * True for an absolute http or https address on a public host name (ADR-0036). Card ids,
 * `wb:` URIs, free text, addresses with user information, IP literals, single-label and
 * special-use or private host names, and wildcard DNS names that embed an IP address are not
 * public external sources. Fails closed.
 */
export function isPublicSourceUri(value: string | undefined): boolean {
  if (value === undefined || !/^https?:\/\//i.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host.startsWith('[') || !host.includes('.')) return false;
  const labels = host.split('.');
  const last = labels[labels.length - 1]!;
  if (last === '' || /^\d+$/.test(last) || /^0x/i.test(last)) return false;
  if (PRIVATE_TLDS.has(last)) return false;
  if (IP_EMBEDDING_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  if (IPV4_DOTTED.test(host) || labels.some((l) => IPV4_DASHED.test(l))) return false;
  return true;
}

/** The origin class of a card (ADR-0036). Pure; fails closed. */
export function originOf(card: CardContent): Origin {
  const type = (card.type ?? '').trim().toLowerCase();
  if (card.author?.startsWith('agent:')) {
    return { originClass: 'conclusion', reason: "agent output on the user's board" };
  }
  if (card.author !== 'human') {
    return { originClass: 'conclusion', reason: 'author unknown' };
  }
  if (type === 'experience' || card.layer === 'experience') {
    return type === 'experience' || (EXTERNAL_TYPES as readonly string[]).includes(type)
      ? { originClass: 'experience', reason: "the user's own experience" }
      : { originClass: 'conclusion', reason: `type ${type || '(none)'} is not shareable` };
  }
  if (!(EXTERNAL_TYPES as readonly string[]).includes(type)) {
    return {
      originClass: 'conclusion',
      reason: `type ${type || '(none)'} is the user's own conclusion`,
    };
  }
  if (card.layer !== 'evidenced' && card.layer !== 'said') {
    return { originClass: 'conclusion', reason: 'unclassified card (no layer)' };
  }
  if (!isPublicSourceUri(card.source)) {
    return { originClass: 'conclusion', reason: 'no public external source' };
  }
  return { originClass: 'external', reason: 'public external source' };
}

const publicEntries = (entries: readonly PlayerEntry[] | undefined): SharedPlayerEntry[] =>
  (entries ?? [])
    .filter((e) => isPublicSourceUri(e.source))
    .map((e) => ({ text: e.text, source: e.source }));

/**
 * What a share carries (ADR-0036): content and provenance only, a source and player entries
 * only with a public address, no origin system, never the personality type, the user's metadata, edges or store identity.
 * Language, the validity period, aliases and external refs are descriptive metadata and are
 * not part of the projection (ADR-0048); `refs` names the owner's private systems. The
 * content hash is recomputed over the projection. Call it only for a card the gate allowed
 * for `share`.
 */
export function shareProjection(card: Card): SharedCard {
  const out: Record<string, unknown> = {};
  for (const key of SHARED_FIELDS) if (card[key] !== undefined) out[key] = card[key];
  // A source leaves only as a public address, whatever the layer (own experience may cite
  // private notes); the origin system names the user's own tooling and never leaves.
  if (!isPublicSourceUri(card.source)) delete out['source'];
  for (const key of SHARED_PLAYER_FIELDS) {
    const entries = publicEntries(card[key]);
    if (entries.length > 0) out[key] = entries;
  }
  out['contentHash'] = computeContentHash(out as unknown as CardContent);
  return structuredClone(out) as unknown as SharedCard;
}
