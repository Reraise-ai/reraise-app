// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

export const CARD_LAYERS = ['evidenced', 'said', 'experience'] as const;

export type CardLayer = (typeof CARD_LAYERS)[number];

export function isCardLayer(value: unknown): value is CardLayer {
  return typeof value === 'string' && (CARD_LAYERS as readonly string[]).includes(value);
}
