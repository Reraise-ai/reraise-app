// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The OpenAPI contract (schemas/openapi/board-api.yaml) as data: operations, their security,
// parameters, request body and response schemas, plus Ajv validators compiled from the contract
// JSON Schemas of @worldbuilder/core (ADR-0016, ADR-0028). The service registers its routes from
// this table, so an operation of the contract without a handler (or the reverse) fails at start.

import { SCHEMAS } from '@worldbuilder/core';
import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const SCHEMA_BASE = 'https://worldbuilder.invalid/schemas/v0/';
const OPENAPI_FILE = fileURLToPath(
  new URL('../../../schemas/openapi/board-api.yaml', import.meta.url),
);

export const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
export type Method = (typeof METHODS)[number];

/** Which credential kinds an operation accepts. */
export type Access = 'any' | 'human' | 'agent';

export interface ParamSpec {
  readonly name: string;
  readonly in: 'path' | 'query';
  readonly required: boolean;
  /** Contract schema reference, e.g. `api.schema.json#/$defs/cursor`. */
  readonly schemaRef: string;
}

export interface Operation {
  readonly id: string;
  readonly method: Method;
  /** Path as written in the contract, e.g. `/lagen/{lageId}`. */
  readonly path: string;
  /** Path in Fastify syntax, e.g. `/lagen/:lageId`. */
  readonly route: string;
  readonly access: Access;
  readonly params: readonly ParamSpec[];
  readonly hasBody: boolean;
  readonly bodyRequired: boolean;
  readonly bodySchemaRef?: string;
  /** Declared statuses with the schema reference of their body (if any). */
  readonly responses: ReadonlyMap<
    number,
    { readonly schemaRef?: string; readonly problem: boolean }
  >;
}

type Json = Record<string, unknown>;

function refToSchemaRef(ref: string): string {
  // '../api.schema.json#/$defs/x' -> 'api.schema.json#/$defs/x'
  return ref.replace(/^(\.\.\/)+/, '');
}

function accessOf(op: Json, root: Json): Access {
  if (op['x-human-only'] === true) return 'human';
  const security = (op['security'] ?? root['security'] ?? []) as Json[];
  const kinds = new Set(security.flatMap((s) => Object.keys(s)));
  if (kinds.size === 1 && kinds.has('agentToken')) return 'agent';
  if (kinds.size === 1 && kinds.has('sessionToken')) return 'human';
  return 'any';
}

/** Parse the contract file into the operation table. */
export function loadOperations(file: string = OPENAPI_FILE): Operation[] {
  const root = parse(readFileSync(file, 'utf8')) as Json;
  const components = (root['components'] ?? {}) as Json;
  const resolve = (node: Json): Json => {
    const ref = node['$ref'];
    if (typeof ref !== 'string') return node;
    const m = /^#\/components\/(parameters|responses)\/(.+)$/.exec(ref);
    if (!m) throw new Error(`unsupported local reference ${ref}`);
    return ((components[m[1]!] as Json)[m[2]!] ?? {}) as Json;
  };
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries((root['paths'] ?? {}) as Record<string, Json>)) {
    const shared = ((item['parameters'] ?? []) as Json[]).map(resolve);
    for (const method of METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      const params = [...shared, ...((op['parameters'] ?? []) as Json[]).map(resolve)].map((p) => {
        const schema = p['schema'] as Json;
        const ref = schema['$ref'];
        if (typeof ref !== 'string')
          throw new Error(`${String(op['operationId'])}: parameter without schema ref`);
        return {
          name: p['name'] as string,
          in: p['in'] as 'path' | 'query',
          required: p['required'] === true,
          schemaRef: refToSchemaRef(ref),
        } satisfies ParamSpec;
      });
      const body = op['requestBody'] as Json | undefined;
      const bodySchema = (body?.['content'] as Json | undefined)?.['application/json'] as
        Json | undefined;
      const bodyRef = (bodySchema?.['schema'] as Json | undefined)?.['$ref'];
      const responses = new Map<number, { schemaRef?: string; problem: boolean }>();
      for (const [status, raw] of Object.entries((op['responses'] ?? {}) as Record<string, Json>)) {
        const response = resolve(raw);
        const content = (response['content'] ?? {}) as Record<string, Json>;
        const media = content['application/json'] ?? content['application/problem+json'];
        const ref = (media?.['schema'] as Json | undefined)?.['$ref'];
        responses.set(Number(status), {
          ...(typeof ref === 'string' ? { schemaRef: refToSchemaRef(ref) } : {}),
          problem: content['application/problem+json'] !== undefined,
        });
      }
      operations.push({
        id: op['operationId'] as string,
        method,
        path,
        route: path.replace(/\{([^}]+)\}/g, ':$1'),
        access: accessOf(op, root),
        params,
        hasBody: body !== undefined,
        bodyRequired: body?.['required'] === true,
        ...(typeof bodyRef === 'string' ? { bodySchemaRef: refToSchemaRef(bodyRef) } : {}),
        responses,
      });
    }
  }
  return operations;
}

export type Check = (data: unknown) => { ok: true } | { ok: false; message: string };

function makeAjv(coerceTypes: boolean): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes });
  // ajv-formats is CommonJS; under NodeNext its default import is the module object.
  (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
  for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
  return ajv;
}

/**
 * Validators for contract schema references. `strict` ones never coerce (bodies and
 * responses); `coerced` ones turn query strings into numbers first (query and path values).
 */
export class Validators {
  private readonly strictAjv = makeAjv(false);
  private readonly coercingAjv = makeAjv(true);
  private readonly cache = new Map<string, Check>();
  private readonly coercers = new Map<string, ValidateFunction>();

  private compile(ajv: Ajv2020, ref: string): Check {
    const validate = ajv.compile({ $ref: SCHEMA_BASE + ref });
    return (data) =>
      validate(data)
        ? { ok: true }
        : {
            ok: false,
            message: (validate.errors ?? [])
              .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
              .join('; '),
          };
  }

  strict(ref: string): Check {
    const key = `s:${ref}`;
    let check = this.cache.get(key);
    if (!check) this.cache.set(key, (check = this.compile(this.strictAjv, ref)));
    return check;
  }

  /** Validates a scalar parameter, coercing a query string to the schema's type. */
  coerced(
    ref: string,
  ): (raw: unknown) => { ok: true; value: unknown } | { ok: false; message: string } {
    const key = `c:${ref}`;
    let compiled = this.coercers.get(key);
    if (!compiled) {
      compiled = this.coercingAjv.compile({
        type: 'object',
        properties: { v: { $ref: SCHEMA_BASE + ref } },
        required: ['v'],
      });
      this.coercers.set(key, compiled);
    }
    const validate = compiled;
    return (raw) => {
      // Ajv coerces in place, so the value travels inside a holder object.
      const holder = { v: raw };
      return validate(holder)
        ? { ok: true, value: holder.v }
        : {
            ok: false,
            message: (validate.errors ?? [])
              .map((e) => `${e.instancePath.replace(/^\/v/, '') || '/'} ${e.message ?? 'invalid'}`)
              .join('; '),
          };
    };
  }
}

/** Shared validators; compiling the contract schemas once per process. */
export const validators = new Validators();
