// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// MCP tool contract (ADR-0016). Input and output schemas reference the JSON Schemas in
// schemas/ by `$id`; the server dereferences them when it registers the tools with the MCP
// SDK (M1). Each tool has a Board API operation with the same name and the same schemas
// (parity test in tools.test.ts). proposal_create is the only tool with side effects
// (ADR-0011); there is no tool that reads or writes stances (ADR-0008). Identity and
// disclosure target come from the registered connection, never from tool input (ADR-0012).

export const SCHEMA_BASE = 'https://worldbuilder.invalid/schemas/v0/';

export interface SchemaRef {
  readonly type: 'object';
  readonly $ref: string;
}

/** MCP tool definition (name, description, input and output schema, annotations). */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: false;
    readonly openWorldHint: false;
  };
}

const schema = (ref: string): SchemaRef => ({ type: 'object', $ref: `${SCHEMA_BASE}${ref}` });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const TOOLS = [
  {
    name: 'world_list',
    title: 'List worlds',
    description: 'Lists the worlds of the connected store.',
    inputSchema: schema('api.schema.json#/$defs/emptyRequest'),
    outputSchema: schema('api.schema.json#/$defs/worldList'),
    annotations: READ_ONLY,
  },
  {
    name: 'lage_get',
    title: 'Get a Lage',
    description: 'Returns a Lage (board state: question, options, placed cards, seats, edges).',
    inputSchema: schema('api.schema.json#/$defs/lageGetRequest'),
    outputSchema: schema('card.schema.json'),
    annotations: READ_ONLY,
  },
  {
    name: 'cards_search',
    title: 'Search cards',
    description:
      'Searches cards cleared by the disclosure gate for this connection. Each card states its layer (evidenced, said, experience) and provenance.',
    inputSchema: schema('api.schema.json#/$defs/cardsSearchRequest'),
    outputSchema: schema('api.schema.json#/$defs/cardPage'),
    annotations: READ_ONLY,
  },
  {
    name: 'card_get',
    title: 'Get a card',
    description: 'Returns one card if the disclosure gate allows it for this connection.',
    inputSchema: schema('api.schema.json#/$defs/cardGetRequest'),
    outputSchema: schema('card.schema.json'),
    annotations: READ_ONLY,
  },
  {
    name: 'context_package_get',
    title: 'Get a context package',
    description:
      'Builds a context package for this connection: gate-cleared cards with layer, author, provenance and independence; pending proposals listed separately; never stances.',
    inputSchema: schema('context-package.schema.json#/$defs/request'),
    outputSchema: schema('context-package.schema.json'),
    annotations: READ_ONLY,
  },
  {
    name: 'rules_evaluate',
    title: 'Evaluate rules',
    description:
      "Lists which of the user's rules fire on a Lage and which cards triggered them. No percentage, no recommendation; rules this connection may not see are only counted.",
    inputSchema: schema('rule-evaluation.schema.json#/$defs/request'),
    outputSchema: schema('rule-evaluation.schema.json'),
    annotations: READ_ONLY,
  },
  {
    name: 'proposal_create',
    title: 'Propose a move',
    description:
      'The only way for an agent to change the world: proposes placing or moving a card, drawing an edge, creating a card or commenting. A human accepts or rejects it; until then it counts nowhere.',
    inputSchema: schema('proposal.schema.json#/$defs/create'),
    outputSchema: schema('proposal.schema.json'),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'proposal_list',
    title: 'List proposals',
    description: 'Lists proposals and their status.',
    inputSchema: schema('api.schema.json#/$defs/proposalListRequest'),
    outputSchema: schema('api.schema.json#/$defs/proposalPage'),
    annotations: READ_ONLY,
  },
] as const satisfies readonly ToolDefinition[];

export type ToolName = (typeof TOOLS)[number]['name'];
