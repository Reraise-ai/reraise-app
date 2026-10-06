// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Validation against the contract schemas (ADR-0016): the JSON Schemas are the rules; the
// generated types only describe shapes.

import { SCHEMAS } from '@worldbuilder/core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

const BASE = 'https://worldbuilder.invalid/schemas/v0/';

export type ValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

let ajv: Ajv2020 | undefined;
const cache = new Map<string, (data: unknown) => ValidationResult>();

/** Validate `data` against a contract schema, e.g. `knowledge-receipt.schema.json`. */
export function validateContract(ref: string, data: unknown): ValidationResult {
  let validator = cache.get(ref);
  if (!validator) {
    if (!ajv) {
      ajv = new Ajv2020({ strict: true, allErrors: true });
      // ajv-formats is CommonJS; under NodeNext its default import is the module object.
      (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
      for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
    }
    const validate = ajv.getSchema(BASE + ref);
    if (!validate) throw new Error(`unknown contract schema ${ref}`);
    validator = (d) =>
      validate(d)
        ? { ok: true }
        : {
            ok: false,
            message: (validate.errors ?? [])
              .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
              .join('; '),
          };
    cache.set(ref, validator);
  }
  return validator(data);
}

/** Throw when `data` does not satisfy the contract schema `ref`. */
export function assertContract(ref: string, data: unknown, what: string): void {
  const result = validateContract(ref, data);
  if (!result.ok) throw new Error(`${what} does not satisfy ${ref}: ${result.message}`);
}
