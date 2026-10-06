// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

import { TOOLS, type ToolName } from './tools.js';

export { SCHEMA_BASE, TOOLS } from './tools.js';
export type { SchemaRef, ToolDefinition, ToolName } from './tools.js';

/** Tool contract names. proposal_create is the only write path for agents. */
export const MCP_TOOL_NAMES: readonly ToolName[] = TOOLS.map((t) => t.name);
