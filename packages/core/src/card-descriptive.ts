// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Descriptive card fields (ADR-0048): language, validity period, aliases and external refs.
// They are not content: none of them enters the content hash.

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
