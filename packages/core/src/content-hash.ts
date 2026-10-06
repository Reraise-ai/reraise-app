// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Content hash of a card (ADR-0006, ADR-0034): `sha256:` + lower-case hex SHA-256 over the
// RFC 8785 JSON Canonicalization Scheme (JCS) serialisation of the hashed content.

import type { CardContent } from './generated/contracts.js';
import { sha256 } from './ids.js';

/**
 * Fields never hashed: identity, the hash itself, reserved fields, and fields a store carries
 * without product semantics (ADR-0023). Stance data is not a card field and never hashed.
 */
export const CONTENT_HASH_EXCLUDED = [
  'id',
  'externalId',
  'uri',
  'contentHash',
  'signature',
  'level',
  'typeRaw',
  'rating',
  'carrier',
  'affiliation',
] as const;

/** Compare strings by UTF-16 code units, as RFC 8785 requires for object keys. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * RFC 8785 (JCS) serialisation. Strings and numbers use the ECMAScript JSON rules that JCS
 * adopts; object keys are sorted by UTF-16 code units; `undefined` members are omitted.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS cannot serialise NaN or Infinity');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => byCodeUnits(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new Error(`JCS cannot serialise a ${typeof value}`);
}

/** The part of a card that the content hash covers. */
export function hashedContent(card: CardContent): Record<string, unknown> {
  const content: Record<string, unknown> = { ...card };
  for (const key of CONTENT_HASH_EXCLUDED) delete content[key];
  return content;
}

/** `sha256:<hex>` of the JCS serialisation of the hashed card content. */
export function computeContentHash(card: CardContent): string {
  const bytes = sha256(new TextEncoder().encode(canonicalJson(hashedContent(card))));
  return `sha256:${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
