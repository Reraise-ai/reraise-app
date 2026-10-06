// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { Layer } from './generated/contracts.js';

/** Types generated from the JSON Schemas in schemas/ (the source of truth, ADR-0016). */
export type * from './generated/contracts.js';

export const CARD_LAYERS = ['evidenced', 'said', 'experience'] as const satisfies readonly Layer[];

export type CardLayer = (typeof CARD_LAYERS)[number];

export function isCardLayer(value: unknown): value is CardLayer {
  return typeof value === 'string' && (CARD_LAYERS as readonly string[]).includes(value);
}
