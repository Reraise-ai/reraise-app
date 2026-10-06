// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { makeTree } from './test-helpers.mjs';
import { validateSchemas } from './validate-schemas.mjs';

const good = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.org/good.schema.json',
  type: 'object',
  properties: { id: { type: 'string', format: 'date-time' } },
});

describe('validateSchemas', () => {
  it('passes when there are no schemas yet', () => {
    expect(validateSchemas(makeTree({ 'README.md': 'x' }))).toEqual({ count: 0, problems: [] });
  });

  it('accepts valid 2020-12 schemas', () => {
    const root = makeTree({ 'schemas/good.schema.json': good });
    expect(validateSchemas(root)).toEqual({ count: 1, problems: [] });
  });

  it('rejects broken JSON and invalid schemas', () => {
    const root = makeTree({
      'schemas/broken.schema.json': '{ nope',
      'schemas/bad.schema.json': JSON.stringify({ type: 'not-a-type' }),
    });
    const { problems } = validateSchemas(root);
    expect(problems).toHaveLength(2);
  });
});
