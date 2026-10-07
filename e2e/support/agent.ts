// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The scripted test agent of the e2e (ADR-0037): an MCP client of the official SDK over Streamable
// HTTP with the bearer token of a registered agent connection, exactly as the Hermes guide
// describes. It reads the token from the owner-only file, never from a command line.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readToken } from './env.js';

export interface ScriptedAgent {
  /** Calls a tool and returns its structured result; a tool error throws with its text. */
  call<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>;
  listTools(): Promise<string[]>;
  close(): Promise<void>;
}

export async function connectAgent(serviceUrl: string, tokenFile: string): Promise<ScriptedAgent> {
  const client = new Client({ name: 'worldbuilder-e2e-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', serviceUrl), {
    requestInit: { headers: { authorization: `Bearer ${readToken(tokenFile)}` } },
  });
  await client.connect(transport);
  return {
    async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
      if (result.structuredContent === undefined) throw new Error(`${name}: no structured result`);
      return result.structuredContent as T;
    },
    async listTools() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    close: () => client.close(),
  };
}
