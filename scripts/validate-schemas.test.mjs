// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeTree } from './test-helpers.mjs';
import {
  SCHEMA_BASE,
  collectUlids,
  loadSchemas,
  schemaId,
  validateSchemas,
} from './validate-schemas.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFiles = readdirSync(path.join(repoRoot, 'schemas')).filter((f) =>
  f.endsWith('.schema.json'),
);
const copySchemas = () =>
  Object.fromEntries(
    schemaFiles.map((f) => [
      `schemas/${f}`,
      readFileSync(path.join(repoRoot, 'schemas', f), 'utf8'),
    ]),
  );

const good = (name) =>
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${SCHEMA_BASE}${name}`,
    title: 'Thing',
    type: 'object',
    properties: { at: { type: 'string', format: 'date-time' } },
    required: ['at'],
    additionalProperties: false,
  });
const envelope = (name, data, extra = {}) =>
  JSON.stringify({ synthetic: true, schema: schemaId(name), description: 'x', data, ...extra });

describe('validateSchemas on the repository', () => {
  const result = validateSchemas(repoRoot);

  it('has no problems', () => {
    expect(result.problems).toEqual([]);
  });

  it('compiles every schema and checks examples and fixtures', () => {
    expect(result.count).toBe(schemaFiles.length);
    expect(result.examples).toBeGreaterThanOrEqual(20);
    expect(result.fixtures.valid).toBeGreaterThan(0);
    expect(result.fixtures.invalid).toBeGreaterThanOrEqual(schemaFiles.length - 1);
  });
});

describe('schema compilation', () => {
  it('accepts a strict 2020-12 schema with a versioned $id', () => {
    const root = makeTree({ 'schemas/thing.schema.json': good('thing.schema.json') });
    expect(loadSchemas(root).problems).toEqual([]);
  });

  it('rejects broken JSON, wrong $id, missing title and strict-mode violations', () => {
    const root = makeTree({
      'schemas/broken.schema.json': '{ nope',
      'schemas/wrong-id.schema.json': good('other.schema.json'),
      'schemas/untyped.schema.json': JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `${SCHEMA_BASE}untyped.schema.json`,
        title: 'Untyped',
        properties: { a: { minimum: 1 } },
      }),
    });
    const { problems } = loadSchemas(root);
    expect(problems.some((p) => p.startsWith('schemas/broken.schema.json'))).toBe(true);
    expect(problems.some((p) => p.includes('wrong-id.schema.json: $id must be'))).toBe(true);
    expect(problems.some((p) => p.includes('untyped.schema.json') && p.includes('strict'))).toBe(
      true,
    );
  });
});

describe('fixtures', () => {
  const schemas = { 'schemas/thing.schema.json': good('thing.schema.json') };
  const valid = { at: '2026-09-16T10:00:00Z' };

  it('requires a valid and an invalid case per schema', () => {
    const { problems } = validateSchemas(makeTree(schemas));
    expect(problems).toEqual([
      'schemas/thing.schema.json: no valid example or fixture',
      'schemas/thing.schema.json: no invalid fixture',
    ]);
  });

  it('passes when the invalid fixture fails with the declared keyword', () => {
    const root = makeTree({
      ...schemas,
      'schemas/fixtures/valid/ok.json': envelope('thing.schema.json', valid),
      'schemas/fixtures/invalid/missing.json': envelope(
        'thing.schema.json',
        {},
        { expect: { keyword: 'required', instancePath: '' } },
      ),
    });
    expect(validateSchemas(root).problems).toEqual([]);
  });

  it('reports invalid fixtures that pass or fail for another reason', () => {
    const root = makeTree({
      ...schemas,
      'schemas/fixtures/valid/bad.json': envelope('thing.schema.json', {}),
      'schemas/fixtures/invalid/passes.json': envelope('thing.schema.json', valid, {
        expect: { keyword: 'required' },
      }),
      'schemas/fixtures/invalid/other-reason.json': envelope(
        'thing.schema.json',
        { at: 'yesterday' },
        { expect: { keyword: 'required' } },
      ),
      'schemas/fixtures/invalid/no-expect.json': envelope('thing.schema.json', {}),
      'schemas/fixtures/invalid/unknown-schema.json': envelope(
        'nothing.schema.json',
        {},
        { expect: { keyword: 'required' } },
      ),
    });
    const out = validateSchemas(root).problems.join('\n');
    expect(out).toContain('valid/bad.json: should be valid');
    expect(out).toContain('passes.json: should be INVALID');
    expect(out).toContain('other-reason.json: failed, but not with required');
    expect(out).toContain('no-expect.json: "expect"');
    expect(out).toContain('unknown-schema.json: "schema" must be the $id');
  });
});

describe('examples', () => {
  const store = 'synthetic: true\nstoreInstanceId: 45aaff12-777f-40e3-a97c-8a592e1ea4f6\n';
  const id = '01M1E34QM03WVTE8T1RYS3AM18';
  const other = '01M1E6JK80GR8G0JHMPVT7TDX4';
  const cardFile = (extra = '') =>
    `---\nid: ${id}\nformat: 2\ntype: claim\ntitle: A claim\nlayer: said\nauthor: human\nsource: https://example.org/a\n${extra}synthetic: true\n---\nBody\n`;

  it('validates markdown cards against the card schema and checks references', () => {
    const root = makeTree({
      ...copySchemas(),
      'examples/w/worldbuilder-store.yaml': store,
      'examples/w/cards/a.md': cardFile(`edges: [${other}|cites|human]\n`),
    });
    const problems = validateSchemas(root).problems.filter((p) => p.startsWith('examples/'));
    expect(problems).toEqual([
      `examples/w/cards/a.md: /edges/0/target references unknown id ${other}`,
    ]);
  });

  it('reports invalid cards, missing synthetic markers and unknown files', () => {
    const root = makeTree({
      ...copySchemas(),
      'examples/w/worldbuilder-store.yaml': store,
      'examples/w/cards/a.md': cardFile().replace('source: https://example.org/a\n', ''),
      'examples/w/cards/b.md': `---\nid: ${other}\nformat: 1\ntype: topic\ntitle: T\nauthor: unknown\n---\n`,
      'examples/w/notes.txt': 'x',
      'examples/w/thing.json': JSON.stringify({ schema: schemaId('world.schema.json'), data: {} }),
    });
    const out = validateSchemas(root).problems.join('\n');
    expect(out).toContain('examples/w/cards/a.md: invalid against card.schema.json');
    expect(out).toContain('examples/w/cards/b.md: needs synthetic: true');
    expect(out).toContain('examples/w/notes.txt: unrecognised example file');
    expect(out).toContain('examples/w/thing.json: needs "synthetic": true');
  });

  it('requires a store configuration for cards', () => {
    const root = makeTree({ ...copySchemas(), 'examples/w/cards/a.md': cardFile() });
    expect(validateSchemas(root).problems.join('\n')).toContain('missing worldbuilder-store.yaml');
  });
});

describe('collectUlids', () => {
  it('finds exact ULID strings with their paths', () => {
    expect(
      collectUlids({
        a: ['01M1E34QM03WVTE8T1RYS3AM18', 'x'],
        b: { c: 'not 01M1E34QM03WVTE8T1RYS3AM18' },
      }),
    ).toEqual([{ id: '01M1E34QM03WVTE8T1RYS3AM18', at: '/a/0' }]);
  });
});
