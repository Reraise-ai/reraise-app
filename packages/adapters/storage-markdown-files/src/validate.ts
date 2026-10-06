// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { SCHEMAS } from '@worldbuilder/core';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

const BASE = 'https://worldbuilder.invalid/schemas/v0/';

let ajv: Ajv2020 | undefined;

/** A validator for one contract schema of `schemas/` (optionally with a `#/$defs/...` pointer). */
export function schemaValidator(ref: string): ValidateFunction {
  if (!ajv) {
    ajv = new Ajv2020({ strict: true, allErrors: true });
    // ajv-formats is CommonJS; under NodeNext its default import is the module object.
    (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
    for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
  }
  const validate = ajv.getSchema(ref.startsWith('http') ? ref : BASE + ref);
  if (!validate) throw new Error(`unknown schema ${ref}`);
  return validate;
}

/** Human-readable summary of Ajv errors. */
export function describeErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
    .join('; ');
}
