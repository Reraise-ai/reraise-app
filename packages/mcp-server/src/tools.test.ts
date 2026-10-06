// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Parity between the MCP tools and the Board API (ADR-0016): every tool has an operation with
// the same name and the same input and output schemas; every other operation is human-only.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { SCHEMA_BASE, TOOLS } from './tools.js';

interface Operation {
  operationId: string;
  security?: Record<string, string[]>[];
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: { $ref: string } }> };
  responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }>;
  'x-human-only'?: boolean;
}
interface Parameter {
  $ref?: string;
  name: string;
  in: string;
  schema: { $ref: string };
}

const schemasDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schemas');
const api = parse(readFileSync(path.join(schemasDir, 'openapi/board-api.yaml'), 'utf8')) as {
  security: Record<string, string[]>[];
  paths: Record<string, Record<string, Operation | Parameter[]>>;
  components: { parameters: Record<string, Parameter> };
};

/** `../card.schema.json#/x` (relative to schemas/openapi) -> the schema `$id` form. */
const absolute = (ref: string) => {
  expect(ref.startsWith('../'), ref).toBe(true);
  return `${SCHEMA_BASE}${ref.slice(3)}`;
};
const param = (p: Parameter) =>
  p.$ref ? api.components.parameters[p.$ref.replace('#/components/parameters/', '')]! : p;

const operations = new Map<string, { op: Operation; params: Parameter[] }>();
for (const item of Object.values(api.paths)) {
  const shared = ((item['parameters'] as Parameter[] | undefined) ?? []).map(param);
  for (const [method, op] of Object.entries(item)) {
    if (method === 'parameters') continue;
    const o = op as Operation;
    operations.set(o.operationId, {
      op: o,
      params: [...shared, ...(o.parameters ?? []).map(param)],
    });
  }
}

const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'));
const ajv = new Ajv2020({ strict: true });
(addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
for (const f of schemaFiles)
  ajv.addSchema(JSON.parse(readFileSync(path.join(schemasDir, f), 'utf8')));

/** Resolve a schema `$id#pointer` to the schema object it names. */
function resolve(ref: string): Record<string, unknown> {
  const [id, pointer = ''] = ref.split('#');
  const file = (id ?? '').replace(SCHEMA_BASE, '');
  let node: unknown = JSON.parse(readFileSync(path.join(schemasDir, file), 'utf8'));
  for (const part of pointer.split('/').filter(Boolean)) {
    node = (node as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node as Record<string, unknown>;
}

describe('MCP tool definitions', () => {
  it('reference schemas that exist and compile', () => {
    for (const tool of TOOLS) {
      for (const s of [tool.inputSchema, tool.outputSchema]) {
        expect(s.type).toBe('object');
        expect(ajv.getSchema(s.$ref), s.$ref).toBeTypeOf('function');
      }
    }
  });

  it('have exactly one tool with side effects: proposal_create (ADR-0011, ADR-0016)', () => {
    expect(TOOLS.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual([
      'proposal_create',
    ]);
  });

  it('have no stance tool and take no target, author or identity as input (ADR-0008, ADR-0012)', () => {
    expect(TOOLS.filter((t) => /stance/i.test(t.name))).toEqual([]);
    for (const tool of TOOLS) {
      const props = Object.keys((resolve(tool.inputSchema.$ref).properties ?? {}) as object);
      expect(props.filter((p) => ['target', 'author', 'decidedBy', 'id'].includes(p))).toEqual([]);
    }
  });
});

describe('MCP / Board API parity', () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))(
    '%s has an HTTP operation with the same schemas',
    (_name, tool) => {
      const entry = operations.get(tool.name);
      expect(entry, `operation ${tool.name}`).toBeDefined();
      const { op, params } = entry!;
      expect(op['x-human-only']).toBeUndefined();

      const ok = op.responses['200'] ?? op.responses['201'];
      expect(absolute(ok!.content!['application/json']!.schema.$ref)).toBe(tool.outputSchema.$ref);

      const body = op.requestBody?.content['application/json']?.schema.$ref;
      if (body !== undefined) {
        expect(absolute(body)).toBe(tool.inputSchema.$ref);
        expect(params).toEqual([]);
      } else {
        const input = resolve(tool.inputSchema.$ref);
        expect(params.map((p) => p.name).sort()).toEqual(
          Object.keys(input.properties as object).sort(),
        );
        for (const p of params) {
          expect(absolute(p.schema.$ref), p.name).toBe(
            `${tool.inputSchema.$ref}/properties/${p.name}`,
          );
        }
        const required = (input.required as string[] | undefined) ?? [];
        for (const p of params) expect(p.in === 'path', p.name).toBe(required.includes(p.name));
      }
    },
  );

  it('lets agent tokens call every mirrored operation, and only agents propose', () => {
    expect(api.security).toEqual([{ sessionToken: [] }, { agentToken: [] }]);
    for (const tool of TOOLS) {
      const security = operations.get(tool.name)?.op.security;
      // proposal_create is agent-only: humans act directly (ADR-0011, ADR-0028).
      if (tool.name === 'proposal_create') expect(security).toEqual([{ agentToken: [] }]);
      else expect(security).toBeUndefined();
    }
  });

  it('reaches stances only through human-only operations (ADR-0008)', () => {
    const stanceOps = [...operations].filter(([id, { op }]) => {
      const refs = JSON.stringify(op);
      return /stance/i.test(id) || refs.includes('stance.schema.json');
    });
    expect(stanceOps.map(([id]) => id).sort()).toEqual(['stance_get', 'stance_save']);
    for (const [id, { op }] of stanceOps) {
      expect(op['x-human-only'], id).toBe(true);
      expect(op.security, id).toEqual([{ sessionToken: [] }]);
    }
  });

  it('marks every other operation human-only with the session token only (ADR-0026)', () => {
    const tools = new Set<string>(TOOLS.map((t) => t.name));
    const humanOnly = [...operations].filter(([id]) => !tools.has(id));
    expect(humanOnly.map(([id]) => id).sort()).toEqual([
      'decision_create',
      'decision_save',
      'disclosure_confirm',
      'disclosure_transfer_get',
      'disclosure_transfer_preview',
      'lage_create',
      'lage_save',
      'proposal_accept',
      'proposal_reject',
      'stance_get',
      'stance_save',
    ]);
    for (const [id, { op }] of humanOnly) {
      expect(op['x-human-only'], id).toBe(true);
      expect(op.security, id).toEqual([{ sessionToken: [] }]);
      expect(Object.keys(op.responses), id).toContain('403');
    }
  });

  it('answers 413 for every request body that exceeds the size limit (ADR-0026)', () => {
    for (const [id, { op }] of operations) {
      if (op.requestBody) expect(Object.keys(op.responses), id).toContain('413');
    }
  });
});
