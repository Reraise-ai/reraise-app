// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

import { expect, it } from 'vitest';
import { MCP_TOOL_NAMES } from './index.js';

it('declares the eight contract tools with a single write tool', () => {
  expect(MCP_TOOL_NAMES).toHaveLength(8);
  expect(MCP_TOOL_NAMES.filter((n) => n.endsWith('_create'))).toEqual(['proposal_create']);
});
