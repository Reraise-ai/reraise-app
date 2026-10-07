// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

import { TOOLS, type ToolName } from './tools.js';

export { SCHEMA_BASE, TOOLS } from './tools.js';
export type { SchemaRef, ToolDefinition, ToolName } from './tools.js';
export { bundleSchema, type SchemaTable } from './schema-bundle.js';
export {
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  createToolServer,
  listedTools,
  type ToolInvoker,
  type ToolOutcome,
  type ToolServerOptions,
} from './server.js';
export {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_SESSIONS_PER_CALLER,
  McpSessions,
  type McpSessionsOptions,
} from './sessions.js';
export {
  BridgeError,
  DEFAULT_SERVICE_URL,
  TOKEN_ENV,
  TOKEN_FILE_ENV,
  URL_ENV,
  bridgeMain,
  mcpUrl,
  resolveToken,
  runBridge,
  type BridgeMainIo,
  type BridgeOptions,
} from './bridge.js';

/** Tool contract names. Every agent write is a proposal (ADR-0011, ADR-0039). */
export const MCP_TOOL_NAMES: readonly ToolName[] = TOOLS.map((t) => t.name);
