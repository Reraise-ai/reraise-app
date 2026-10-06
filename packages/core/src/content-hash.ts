// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Content hash of a card (ADR-0006, ADR-0034): `sha256:` + lower-case hex SHA-256 over the
// RFC 8785 JSON Canonicalization Scheme (JCS) serialisation of the hashed content.

import type { CardContent, DisclosurePreviewEnvelope } from './generated/contracts.js';
import { sha256 } from './ids.js';

/**
 * The substantive card fields that identify the information itself (ADR-0034). Everything
 * else is identity, the hash itself, reserved, or user and organisational metadata, which
 * differs between stores holding the same information; stance data is never a card field.
 */
export const CONTENT_HASH_FIELDS = [
  'type',
  'title',
  'body',
  'layer',
  'source',
  'sourceDate',
  'sourceChecksum',
  'date',
  'interests',
  'capabilities',
  'dependencies',
  'moves',
  'sections',
  'lage',
  'rule',
] as const;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Fields that hold a card's structured content; when present, `body` is not hashed. */
export const STRUCTURED_FIELDS = ['sections', 'lage', 'rule'] as const;

/** Compare strings by UTF-16 code units, as RFC 8785 requires for object keys. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * RFC 8785 (JCS) serialisation. Strings and numbers use the ECMAScript JSON rules that JCS
 * adopts; object keys are sorted by UTF-16 code units; `undefined` members are omitted.
 */
export function canonicalJson(value: unknown): string {
  if (typeof value === 'string') {
    if (LONE_SURROGATE.test(value)) throw new Error('JCS cannot serialise a lone surrogate');
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS cannot serialise NaN or Infinity');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      throw new Error('JCS serialises plain JSON objects only (no Date, Map or class instance)');
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => byCodeUnits(a, b));
    return `{${entries.map(([k, v]) => `${canonicalJson(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new Error(`JCS cannot serialise a ${typeof value}`);
}

/** The part of a card that the content hash covers. */
export function hashedContent(card: CardContent): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const key of CONTENT_HASH_FIELDS) {
    if (card[key] !== undefined) content[key] = card[key];
  }
  // A card with structured content is hashed by its structure: its Markdown body only renders
  // it (headings in any language), so the same decision in two stores hashes the same.
  if (STRUCTURED_FIELDS.some((f) => card[f] !== undefined)) delete content['body'];
  return content;
}

/** `sha256:<hex>` of the JCS serialisation of any JSON value. */
export function hashJcs(value: unknown): string {
  const bytes = sha256(new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** `sha256:<hex>` of the JCS serialisation of the hashed card content (ADR-0034). */
export function computeContentHash(card: CardContent): string {
  return hashJcs(hashedContent(card));
}

/** Payload hash of a disclosure preview envelope (ADR-0031): JCS hash of the envelope. */
export function computePayloadHash(envelope: DisclosurePreviewEnvelope): string {
  return hashJcs(envelope);
}
