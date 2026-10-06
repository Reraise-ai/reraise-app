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

/** Card types that are the user's own conclusions whatever their fields say. */
export const CONCLUSION_TYPES = ['decision', 'rule', 'rating', 'assumption', 'lage'] as const;

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
  'originSystem',
  'author',
] as const;

const PRIVATE_HOST = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|\[.*\]|[\d.]+)$/i;

/**
 * True for an absolute http or https address on a public host name. Card ids, `wb:` URIs,
 * free text, IP literals and local host names are not public external sources.
 */
export function isPublicSourceUri(value: string | undefined): boolean {
  if (value === undefined || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.hostname.length > 0 && !PRIVATE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** The origin class of a card (ADR-0036). Pure; fails closed. */
export function originOf(card: CardContent): Origin {
  if ((CONCLUSION_TYPES as readonly string[]).includes(card.type ?? '')) {
    return { originClass: 'conclusion', reason: `type ${card.type} is the user's own conclusion` };
  }
  if (card.author?.startsWith('agent:')) {
    return { originClass: 'conclusion', reason: "agent output on the user's board" };
  }
  if (card.author !== 'human') {
    return { originClass: 'conclusion', reason: 'author unknown' };
  }
  if (card.layer === 'experience' || card.type === 'experience') {
    return { originClass: 'experience', reason: "the user's own experience" };
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
 * What a share carries (ADR-0036): content and provenance only, player entries with a public
 * source only, never the personality type, the user's metadata, edges or store identity. The
 * content hash is recomputed over the projection. Call it only for a card the gate allowed
 * for `share`.
 */
export function shareProjection(card: Card): SharedCard {
  const out: Record<string, unknown> = {};
  for (const key of SHARED_FIELDS) if (card[key] !== undefined) out[key] = card[key];
  for (const key of SHARED_PLAYER_FIELDS) {
    const entries = publicEntries(card[key]);
    if (entries.length > 0) out[key] = entries;
  }
  out['contentHash'] = computeContentHash(out as unknown as CardContent);
  return structuredClone(out) as unknown as SharedCard;
}
