// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The one rule for "is a decision's outcome known" (ADR-0017, ADR-0039): an outcome is known
// when it is non-blank text other than `open` (any case, surrounding whitespace ignored). The
// schema `proposal.schema.json#/$defs/outcomeText` states the same rule; a test keeps both equal.

/** Matches an outcome that is still open; mirrors `OPEN_OUTCOME_SCHEMA_PATTERN`. */
export const OPEN_OUTCOME = /^\s*open\s*$/i;

/** The pattern the schema uses (JSON Schema has no flags, hence the character classes). */
export const OPEN_OUTCOME_SCHEMA_PATTERN = '^\\s*[Oo][Pp][Ee][Nn]\\s*$';

/** Is `outcome` a known outcome: non-blank text that is not `open`? */
export function isKnownOutcome(outcome: unknown): boolean {
  return typeof outcome === 'string' && /\S/.test(outcome) && !OPEN_OUTCOME.test(outcome);
}
