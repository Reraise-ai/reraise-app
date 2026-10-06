// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { OPEN_OUTCOME, OPEN_OUTCOME_SCHEMA_PATTERN, isKnownOutcome } from './outcome.js';
import { SCHEMAS } from './generated/schemas.js';

describe('isKnownOutcome (ADR-0039)', () => {
  it.each([
    ['open', false],
    [' OPEN ', false],
    ['Open', false],
    ['   ', false],
    ['', false],
    [undefined, false],
    ['Open.', true],
    ['Rerouted; opened a second route', true],
  ])('%j -> %s', (value, known) => {
    expect(isKnownOutcome(value)).toBe(known);
  });

  it('is the rule the schema states', () => {
    const proposal = SCHEMAS['https://worldbuilder.invalid/schemas/v0/proposal.schema.json'] as {
      $defs: { outcomeText: { allOf: { not?: { pattern: string } }[] } };
    };
    const not = proposal.$defs.outcomeText.allOf.find((s) => s.not)!.not!;
    expect(not.pattern).toBe(OPEN_OUTCOME_SCHEMA_PATTERN);
    const schemaRe = new RegExp(OPEN_OUTCOME_SCHEMA_PATTERN);
    for (const s of ['open', ' Open ', 'oPeN', 'Open.', 'opened', 'x open']) {
      expect(schemaRe.test(s)).toBe(OPEN_OUTCOME.test(s));
    }
  });
});
