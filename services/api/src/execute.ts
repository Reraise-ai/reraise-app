// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Running one operation of the contract for one caller: the access rule, the parameters, the
// body, the handler and the check of the response against its contract schema. The HTTP routes
// (app.ts) and the MCP tools (mcp.ts) both end here, so a tool call is the same code path as the
// matching HTTP request (ADR-0029). Failures are thrown as errors that `describeError` maps.

import { validators, type Operation } from './contract.js';
import { handlers, type OperationResult } from './operations.js';
import { HttpError } from './problem.js';
import type { Principal } from './auth.js';
import type { Services } from './services.js';

/** The raw, not yet validated input of a call: path and query values and the JSON body. */
export interface RawInput {
  readonly params?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

export interface ExecuteHooks {
  /** Called when the handler produced a body the contract does not allow (a service bug). */
  readonly onContractViolation?: (operationId: string, status: number) => void;
}

export async function executeOperation(
  services: Services,
  op: Operation,
  principal: Principal,
  raw: RawInput,
  hooks: ExecuteHooks = {},
): Promise<OperationResult> {
  if (op.access === 'human' && principal.kind !== 'human') {
    throw new HttpError(403, 'this operation is for the human session only', 'human-only');
  }
  if (op.access === 'agent' && principal.kind !== 'agent') {
    throw new HttpError(403, 'this operation is for registered agents only');
  }

  // Parameters: unknown query names are rejected; invalid values are a 400 (or a 404 for an
  // operation that declares no 400, as the id then simply does not exist).
  const invalidStatus = op.responses.has(400) ? 400 : 404;
  const rawParams = raw.params ?? {};
  const rawQuery = raw.query ?? {};
  const params: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  const declared = new Set(op.params.filter((p) => p.in === 'query').map((p) => p.name));
  for (const name of Object.keys(rawQuery)) {
    if (!declared.has(name)) throw new HttpError(400, `unknown query parameter ${name}`);
  }
  for (const p of op.params) {
    const value = p.in === 'path' ? rawParams[p.name] : rawQuery[p.name];
    if (value === undefined) {
      if (p.required) throw new HttpError(invalidStatus, `missing parameter ${p.name}`);
      continue;
    }
    const checked = validators.coerced(p.schemaRef)(value);
    if (!checked.ok) {
      throw new HttpError(invalidStatus, `invalid parameter ${p.name}: ${checked.message}`);
    }
    (p.in === 'path' ? params : query)[p.name] = checked.value;
  }

  let body: unknown = undefined;
  if (op.hasBody) {
    body = raw.body;
    if (body === undefined) {
      if (op.bodyRequired) throw new HttpError(400, 'a request body is required');
      body = {};
    }
    if (op.bodySchemaRef) {
      const checked = validators.strict(op.bodySchemaRef)(body);
      if (!checked.ok) throw new HttpError(400, `invalid request: ${checked.message}`);
    }
  }

  const result = await handlers[op.id]!(services, { principal, params, query, body });

  const declaredResponse = op.responses.get(result.status);
  if (declaredResponse?.schemaRef) {
    const checked = validators.strict(declaredResponse.schemaRef)(result.body);
    if (!checked.ok) {
      // A service bug: never send a body the contract does not allow.
      hooks.onContractViolation?.(op.id, result.status);
      throw new HttpError(500, `the response did not match the contract: ${checked.message}`);
    }
  }
  return result;
}
