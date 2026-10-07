// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The tool schemas the MCP client receives: self-contained, equivalent to the contract schemas.

import { SCHEMAS } from '@worldbuilder/core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { bundleSchema } from './schema-bundle.js';
import { listedTools } from './server.js';
import { SCHEMA_BASE, TOOLS } from './tools.js';

const ajvOf = (schemas: readonly object[]) => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
  for (const s of schemas) ajv.addSchema(s);
  return ajv;
};

describe('bundleSchema', () => {
  it('inlines every reference: no $id, no file reference, only local $defs', () => {
    for (const tool of TOOLS) {
      for (const ref of [tool.inputSchema.$ref, tool.outputSchema.$ref]) {
        const bundled = bundleSchema(SCHEMAS, ref);
        const text = JSON.stringify(bundled);
        expect(text, ref).not.toContain('worldbuilder.invalid');
        expect(text, ref).not.toContain('"$id"');
        expect(bundled['type'], ref).toBe('object');
        const refs = [...text.matchAll(/"\$ref":"([^"]*)"/g)].map((m) => m[1]!);
        for (const r of refs) expect(r, ref).toMatch(/^#\/\$defs\//);
        const defs = Object.keys((bundled['$defs'] ?? {}) as object);
        for (const r of refs) expect(defs, ref).toContain(r.replace('#/$defs/', ''));
      }
    }
  });

  it('accepts exactly what the contract schema accepts (samples of valid and invalid input)', () => {
    const contract = ajvOf(Object.values(SCHEMAS));
    const samples: [string, unknown][] = [
      ['api.schema.json#/$defs/cardsSearchRequest', { text: 'x', limit: 3 }],
      ['api.schema.json#/$defs/cardsSearchRequest', { limit: 0 }],
      ['api.schema.json#/$defs/cardsSearchRequest', { surprise: true }],
      ['api.schema.json#/$defs/cardGetRequest', {}],
      ['proposal.schema.json#/$defs/create', { kind: 'comment' }],
      [
        'proposal.schema.json#/$defs/create',
        { kind: 'comment', payload: { cardId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', text: 't' } },
      ],
      ['write-back-receipt.schema.json#/$defs/request', { taskRef: 'task:a' }],
      [
        'write-back-receipt.schema.json#/$defs/request',
        { taskRef: 'task:a', notNeeded: { reason: 'no_new_knowledge' } },
      ],
    ];
    for (const [name, value] of samples) {
      const expected = contract.getSchema(`${SCHEMA_BASE}${name}`)!(value);
      const bundled = ajvOf([]).compile(bundleSchema(SCHEMAS, `${SCHEMA_BASE}${name}`));
      expect(bundled(value), `${name} ${JSON.stringify(value)}`).toBe(expected);
    }
  });

  it('turns boolean property schemas into objects and refuses unknown schemas', () => {
    const table = {
      'https://x.invalid/a.schema.json': {
        $id: 'https://x.invalid/a.schema.json',
        type: 'object',
        properties: { yes: true, no: false, ref: { $ref: 'b.schema.json' } },
      },
      'https://x.invalid/b.schema.json': {
        $id: 'https://x.invalid/b.schema.json',
        type: 'string',
      },
    };
    const out = bundleSchema(table, 'https://x.invalid/a.schema.json') as {
      properties: Record<string, unknown>;
      $defs: Record<string, unknown>;
    };
    expect(out.properties['yes']).toEqual({});
    expect(out.properties['no']).toEqual({ not: {} });
    expect(out.properties['ref']).toEqual({ $ref: '#/$defs/b' });
    expect(out.$defs['b']).toEqual({ type: 'string' });
    expect(() => bundleSchema(table, 'https://x.invalid/missing.schema.json')).toThrow(
      /unknown schema/,
    );
    expect(() => bundleSchema(table, 'https://x.invalid/a.schema.json#/nope')).toThrow(
      /bad pointer/,
    );
  });
});

describe('bundleSchema names', () => {
  it('throws when two different schemas would get the same $defs name', () => {
    const table = {
      'https://x.invalid/root.schema.json': {
        $id: 'https://x.invalid/root.schema.json',
        type: 'object',
        properties: {
          a: { $ref: 'https://x.invalid/one/item.schema.json' },
          b: { $ref: 'https://x.invalid/two/item.schema.json' },
        },
      },
      'https://x.invalid/one/item.schema.json': { type: 'string' },
      'https://x.invalid/two/item.schema.json': { type: 'number' },
    };
    expect(() => bundleSchema(table, 'https://x.invalid/root.schema.json')).toThrow(
      /schema name item is used by/,
    );
  });

  it('accepts the same schema reached by several references', () => {
    const table = {
      'https://x.invalid/root.schema.json': {
        type: 'object',
        properties: {
          a: { $ref: 'item.schema.json' },
          b: { $ref: 'item.schema.json' },
        },
      },
      'https://x.invalid/item.schema.json': { type: 'string' },
    };
    const out = bundleSchema(table, 'https://x.invalid/root.schema.json') as { $defs: object };
    expect(Object.keys(out.$defs)).toEqual(['item']);
  });
});

describe('listedTools', () => {
  it('lists every tool of the contract once, with title, annotations and both schemas', () => {
    const tools = listedTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.outputSchema).toBeDefined();
    }
  });
});
