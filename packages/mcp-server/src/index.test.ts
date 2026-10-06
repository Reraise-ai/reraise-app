// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

import { expect, it } from 'vitest';
import { MCP_TOOL_NAMES } from './index.js';

it('declares the eight contract tools of ADR-0016', () => {
  expect(MCP_TOOL_NAMES).toEqual([
    'world_list',
    'lage_get',
    'cards_search',
    'card_get',
    'context_package_get',
    'rules_evaluate',
    'proposal_create',
    'proposal_list',
  ]);
});
