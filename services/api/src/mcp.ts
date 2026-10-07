// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The MCP front end (ADR-0016, ADR-0029): the tools of packages/mcp-server mounted on the
// service at /mcp. A tool call is an operation of the contract run for the registered agent of
// the bearer token, by the same `executeOperation` as the HTTP route of the same name, so the
// gate, the cloud confirmation, the proposal list and the receipt log are the ones the Board API
// uses. Failures become MCP tool errors that carry the problem details and nothing else.

import { McpSessions, TOOLS, type ToolInvoker, type ToolOutcome } from '@worldbuilder/mcp-server';
import { readFileSync } from 'node:fs';
import type { Principal } from './auth.js';
import type { Operation } from './contract.js';
import { describeError } from './errors.js';
import { executeOperation } from './execute.js';
import { problemOf } from './problem.js';
import type { Services } from './services.js';

const SERVICE_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/** The key of a caller: a session belongs to the agent that opened it. */
export const principalKey = (p: Principal): string =>
  p.kind === 'agent' ? `agent:${p.name}` : 'human';

export interface McpMount {
  readonly sessions: McpSessions<Principal>;
  /** Run one tool for a caller; the same code the HTTP route of the operation runs. */
  invoke(principal: Principal): ToolInvoker;
}

/**
 * Arguments of a tool call as the raw input of its operation: the body of a body operation, else
 * path parameters and query values (an argument the operation does not declare stays in `query`,
 * where `executeOperation` refuses it).
 */
function rawInputOf(op: Operation, args: Record<string, unknown>) {
  if (op.hasBody) return { body: args };
  const paths = new Set(op.params.filter((p) => p.in === 'path').map((p) => p.name));
  const params: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(args))
    (paths.has(name) ? params : query)[name] = value;
  return { params, query };
}

export function createMcpMount(
  services: Services,
  operations: readonly Operation[],
  onError: (message: string, fields: object) => void = () => undefined,
): McpMount {
  const byId = new Map(operations.map((o) => [o.id, o]));
  for (const tool of TOOLS) {
    const op = byId.get(tool.name);
    if (!op) throw new Error(`MCP tool ${tool.name} has no operation in the contract`);
    if (op.access === 'human') throw new Error(`MCP tool ${tool.name} is a human-only operation`);
  }

  const invoke =
    (principal: Principal): ToolInvoker =>
    async (tool, args): Promise<ToolOutcome> => {
      const op = byId.get(tool)!;
      try {
        const result = await executeOperation(services, op, principal, rawInputOf(op, args), {
          onContractViolation: (operation, status) =>
            onError('response violates the contract', { operation, status }),
        });
        return { status: result.status, body: result.body };
      } catch (error) {
        const { status, detail, slug, code } = describeError(error);
        if (status >= 500) onError('tool call failed', { tool, status, code });
        return { status, body: problemOf(status, detail, slug) };
      }
    };

  const sessions = new McpSessions<Principal>({
    invokeFor: invoke,
    keyOf: principalKey,
    version: SERVICE_VERSION,
  });
  return { sessions, invoke };
}
