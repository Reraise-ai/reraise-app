// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { Layer } from './generated/contracts.js';

/** Types generated from the JSON Schemas in schemas/ (the source of truth, ADR-0016). */
export type * from './generated/contracts.js';
/** Adapter interfaces (ADR-0005). */
export type * from './adapters/index.js';
export { GATE_LOG_REASONS } from './adapters/local-state.js';
export {
  CONTENT_HASH_FIELDS,
  canonicalJson,
  computeContentHash,
  computePayloadHash,
  hashJcs,
  hashedContent,
} from './content-hash.js';
export {
  buildUri,
  deriveCardId,
  encodeExternalId,
  encodeUlid,
  isWbUri,
  parseUri,
  sha256,
} from './ids.js';

export {
  EMAIL_PATTERN,
  IBAN_LENGTHS,
  findEmails,
  findIbans,
  findPhoneNumbers,
  isValidIban,
  personalDataKinds,
} from './personal-data.js';
export type { PersonalDataKind } from './personal-data.js';
export { OPEN_OUTCOME, OPEN_OUTCOME_SCHEMA_PATTERN, isKnownOutcome } from './outcome.js';
export {
  EXTERNAL_TYPES,
  SHARED_FIELDS,
  SHARED_PLAYER_FIELDS,
  isPublicSourceUri,
  originOf,
  shareProjection,
} from './sharing.js';
export type { Origin, OriginClass } from './sharing.js';

export const CARD_LAYERS = ['evidenced', 'said', 'experience'] as const satisfies readonly Layer[];

export type CardLayer = (typeof CARD_LAYERS)[number];

export function isCardLayer(value: unknown): value is CardLayer {
  return typeof value === 'string' && (CARD_LAYERS as readonly string[]).includes(value);
}

/** The JSON Schemas of schemas/, keyed by `$id`, for runtime validation. */
export { SCHEMAS } from './generated/schemas.js';
