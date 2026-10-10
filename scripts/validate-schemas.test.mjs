// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashJcs } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { computeContentHash } from './markdown-cards.mjs';
import { makeTree } from './test-helpers.mjs';
import {
  SCHEMA_BASE,
  collectUlids,
  crossCheck,
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

  it('accepts fixtures for a definition inside a schema, but no other fragment', () => {
    const withDefs = JSON.stringify({
      ...JSON.parse(good('thing.schema.json')),
      $defs: { part: { type: 'object', properties: { n: { type: 'integer' } } } },
    });
    const root = makeTree({
      'schemas/thing.schema.json': withDefs,
      'schemas/fixtures/valid/part.json': JSON.stringify({
        schema: `${schemaId('thing.schema.json')}#/$defs/part`,
        description: 'x',
        data: { n: 1 },
      }),
      'schemas/fixtures/invalid/part.json': JSON.stringify({
        schema: `${schemaId('thing.schema.json')}#/$defs/part`,
        description: 'x',
        expect: { keyword: 'type', instancePath: '/n' },
        data: { n: 'one' },
      }),
      'schemas/fixtures/valid/pointer.json': JSON.stringify({
        schema: `${schemaId('thing.schema.json')}#/properties/at`,
        description: 'x',
        data: 'x',
      }),
    });
    const { problems } = validateSchemas(root);
    expect(problems).toEqual([
      `schemas/fixtures/valid/pointer.json: "schema" must be the $id of a schema in schemas/ (got ${schemaId('thing.schema.json')}#/properties/at)`,
    ]);
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

describe('cross-checks', () => {
  it('flag an agent name registered twice (ADR-0037)', () => {
    const c = { name: 'planner', target: 'local_model' };
    const name = 'agent-connections.schema.json';
    expect(crossCheck(name, { connections: [c, { ...c, name: 'scout' }] })).toEqual([]);
    expect(crossCheck(name, { connections: [c, c] }).map((f) => f.check)).toEqual(['agent-names']);
  });

  it('flag a predicted move outside the move options (ADR-0035)', () => {
    const player = { playerCardId: '01M1E34QM03WVTE8T1RYS3AM18', moveOptions: ['a', 'b'] };
    const prediction = { players: [{ ...player, predictedMove: 'c' }] };
    expect(crossCheck('level1-prediction.schema.json', prediction).map((f) => f.check)).toEqual([
      'level1-move',
    ]);
    expect(
      crossCheck('level1-prediction.schema.json', { players: [{ ...player, predictedMove: 'a' }] }),
    ).toEqual([]);
  });

  it('flag a receipt or log entry whose hash is not the hash of its content (ADR-0039, ADR-0040)', () => {
    const receipt = { receiptId: '01M1E34QM03WVTE8T1RYS3AM18', kind: 'knowledge' };
    const sealed = { ...receipt, hash: hashJcs(receipt) };
    expect(crossCheck('knowledge-receipt.schema.json', sealed)).toEqual([]);
    expect(
      crossCheck('write-back-receipt.schema.json', { ...sealed, kind: 'write_back' }).map(
        (f) => f.check,
      ),
    ).toEqual(['receipt-hash']);
    const entry = { v: 1, seq: 0, receipt: sealed };
    expect(crossCheck('receipt-log-entry.schema.json', { ...entry, hash: hashJcs(entry) })).toEqual(
      [],
    );
    expect(
      crossCheck('receipt-log-entry.schema.json', { ...entry, seq: 1, hash: hashJcs(entry) }).map(
        (f) => f.message,
      ),
    ).toEqual([
      `log entry 1 has hash ${hashJcs(entry)}, expected ${hashJcs({ ...entry, seq: 1 })}`,
    ]);
  });

  it('flag digest lines citing a card the page does not cover, and uncited sources (ADR-0043)', () => {
    const a = '01M1E34QM03WVTE8T1RYS3AM18';
    const b = '01M1F8X7G0TTV1CC1FNKTNN0TJ';
    const name = 'digest-page.schema.json';
    const src = (id) => ({ cardId: id, contentHash: `sha256:${'0'.repeat(64)}` });
    expect(crossCheck(name, { lines: [{ cardIds: [a] }], sources: [src(a)] })).toEqual([]);
    expect(
      crossCheck(name, { lines: [{ cardIds: [b] }], sources: [src(a), src(a)] }).map(
        (f) => f.message,
      ),
    ).toEqual([
      `line cites ${b}, which is not a source`,
      `source ${a} is cited by no line`,
      `source ${a} is listed twice`,
    ]);
  });

  it('flag a level-1 player that is not on the board or named twice (ADR-0035)', () => {
    const id = '01M1E34QM03WVTE8T1RYS3AM18';
    const name = 'level1-prediction.schema.json#/$defs/request';
    const player = { playerCardId: id, moveOptions: ['a', 'b'] };
    expect(crossCheck(name, { players: [player], cards: [{ id }] })).toEqual([]);
    expect(crossCheck(name, { players: [player], cards: [] }).map((f) => f.check)).toEqual([
      'level1-players',
    ]);
    expect(
      crossCheck(name, { players: [player, player], cards: [{ id }] }).map((f) => f.message),
    ).toEqual([`player ${id} is named twice`]);
    const a = '01M1F8X7G0TTV1CC1FNKTNN0TJ';
    const whatIf = (cards) => ({
      trigger: { kind: 'assumption_changed', cardIds: [a] },
      players: [player],
      cards: [{ id }, ...cards],
    });
    expect(crossCheck(name, whatIf([{ id: a, type: 'assumption' }]))).toEqual([]);
    expect(crossCheck(name, whatIf([])).map((f) => f.message)).toEqual([
      `trigger card ${a} is not a card of the request`,
    ]);
    expect(crossCheck(name, whatIf([{ id: a, type: 'claim' }])).map((f) => f.message)).toEqual([
      `trigger card ${a} is not an assumption card`,
    ]);
  });

  it('flag any card id in a training record that did not opt in, but not world or proposal ids', () => {
    const opted = '01M1E34QM03WVTE8T1RYS3AM18';
    const other = '01M1E6JK80GR8G0JHMPVT7TDX4';
    const world = '01M1DZPW00JGXPRPG4179ZPNB8';
    const proposal = '01M1HDJG00152WRCXVJBW0VRRT';
    const record = {
      decision: { id: opted, training: true, worlds: [world], sections: { cardsUsed: [opted] } },
      usedCards: [],
      brainstorm: [{ id: proposal, payload: { cardId: opted } }],
    };
    expect(crossCheck('training-export-record.schema.json', record)).toEqual([]);
    record.decision.sections.cardsUsed.push(other);
    expect(crossCheck('training-export-record.schema.json', record)).toEqual([
      {
        check: 'training-opt-in',
        message: `card ${other} did not opt in to training but appears in the record`,
      },
    ]);
  });
});

describe('language tag and validity period (ADR-0048)', () => {
  const { ajv, problems } = loadSchemas(repoRoot);
  const tag = `${schemaId('common.schema.json')}#/$defs/languageTag`;

  it('accepts well-formed BCP 47 tags and rejects malformed ones', () => {
    expect(problems, problems.join('\n')).toEqual([]);
    for (const value of ['de', 'en', 'es-AR', 'zh-Hans', 'zh-Hans-CN', 'x-local']) {
      expect(ajv.validate(tag, value), value).toBe(true);
    }
    for (const value of ['de_DE', 'e', 'en-', '123', 'not a tag', '']) {
      expect(ajv.validate(tag, value), value).toBe(false);
    }
  });

  it('rejects a validity period whose end is earlier than its start', () => {
    const ok = { validFrom: '2026-10-01', validUntil: '2026-10-31' };
    expect(crossCheck('card.schema.json', ok)).toEqual([]);
    expect(crossCheck('card.schema.json', { validFrom: '2026-10-01' })).toEqual([]);
    expect(crossCheck('card.schema.json', { validUntil: '2026-10-31' })).toEqual([]);
    expect(
      crossCheck('card.schema.json', { validFrom: '2026-06-01', validUntil: '2026-06-01' }),
    ).toEqual([]);
    expect(
      crossCheck('card.schema.json', { validFrom: '2026-10-31', validUntil: '2026-10-01' }).map(
        (f) => f.check,
      ),
    ).toEqual(['validity-period']);
  });
});

describe('content-hash cross-check (ADR-0034)', () => {
  it('flags a card in an envelope whose contentHash is stale', () => {
    const card = {
      id: '01M1E34QM03WVTE8T1RYS3AM18',
      uri: 'wb:45aaff12-777f-40e3-a97c-8a592e1ea4f6/01M1E34QM03WVTE8T1RYS3AM18',
      type: 'claim',
      title: 'A claim',
    };
    const fresh = { ...card, contentHash: computeContentHash(card) };
    expect(crossCheck('api.schema.json#/$defs/cardPage', { cards: [fresh] })).toEqual([]);
    const stale = { ...fresh, title: 'Edited' };
    expect(
      crossCheck('api.schema.json#/$defs/cardPage', { cards: [stale] }).map((f) => f.check),
    ).toEqual(['content-hash']);
  });
});
