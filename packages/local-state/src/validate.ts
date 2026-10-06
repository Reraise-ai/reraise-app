// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { SCHEMAS } from '@worldbuilder/core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

const BASE = 'https://worldbuilder.invalid/schemas/v0/';

export type Validator = (data: unknown) => { ok: true } | { ok: false; message: string };

let ajv: Ajv2020 | undefined;
const cache = new Map<string, Validator>();

/** Validator for a contract schema, e.g. `proposal.schema.json#/$defs/create`; compiled once. */
export function validatorFor(ref: string): Validator {
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
    validator = (data) =>
      validate(data)
        ? { ok: true }
        : {
            ok: false,
            message: (validate.errors ?? [])
              .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
              .join('; '),
          };
    cache.set(ref, validator);
  }
  return validator;
}
