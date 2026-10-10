// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Descriptive card fields (ADR-0048): language, validity period, aliases and external refs.
// They are not content. `refs` names the owner's private systems and must not be copied into
// anything that can leave the device.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `validUntil` must not be earlier than `validFrom` when both are set (ADR-0048). Either may
 * stand alone. Equal dates are allowed: the last day is inclusive. Returns a problem message,
 * or `undefined` when the period is absent or in order. Non-dates are ignored; the schema
 * rejects those.
 */
export function validityPeriodError(card: {
  readonly validFrom?: unknown;
  readonly validUntil?: unknown;
}): string | undefined {
  const { validFrom, validUntil } = card;
  if (typeof validFrom !== 'string' || typeof validUntil !== 'string') return undefined;
  if (!ISO_DATE.test(validFrom) || !ISO_DATE.test(validUntil)) return undefined;
  if (validUntil < validFrom) {
    return `validUntil ${validUntil} is earlier than validFrom ${validFrom}`;
  }
  return undefined;
}

/**
 * A copy of `card` without `refs` (ADR-0048). Cloud transfers, level-1 envelopes and training
 * exports copy whole cards; this is what they drop before the copy can leave the device.
 * A card without `refs` is returned as given.
 */
export function withoutPrivateRefs<T extends object>(card: T): T {
  if (!('refs' in card) || card.refs === undefined) return card;
  const copy = { ...card } as T & { refs?: unknown };
  delete copy.refs;
  return copy;
}
