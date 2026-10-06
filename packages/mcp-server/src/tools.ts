// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// MCP tool contract (ADR-0016). Input and output schemas reference the JSON Schemas in
// schemas/ by `$id`; the server dereferences them when it registers the tools with the MCP
// SDK (M1). Each tool has a Board API operation with the same name and the same schemas
// (parity test in tools.test.ts). Every agent write is a proposal (ADR-0011): the only tools
// with side effects are the four that create one, proposal_create, knowledge_write_back,
// decision_record and decision_outcome (ADR-0039); there is no tool that reads or writes
// stances (ADR-0008). Identity and
// disclosure target come from the registered connection, never from tool input (ADR-0012).
// A connection registered as cloud_model receives card content only through a confirmed,
// hash-bound transfer; otherwise responses carry the denied ids and reasons only (ADR-0031).

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
const PROPOSES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

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
      'Builds a context package for this connection: gate-cleared cards with provenance and independence; pending proposals by id and kind only; never stances. For a connection registered as cloud_model it first returns confirmationRequired with a transferId and no content; once the human confirmed that transfer on the board, call again with the transferId to receive exactly the confirmed cards. readOnlyHint stays true: it never changes the world, it only creates or consumes a disclosure transfer.',
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
    annotations: PROPOSES,
  },
  {
    name: 'proposal_list',
    title: 'List proposals',
    description: 'Lists proposals and their status.',
    inputSchema: schema('api.schema.json#/$defs/proposalListRequest'),
    outputSchema: schema('api.schema.json#/$defs/proposalPage'),
    annotations: READ_ONLY,
  },
  {
    name: 'knowledge_consult',
    title: 'Consult the knowledge for a task',
    description:
      'Call this first, at the start of every task. Returns the context package for the task (gate-cleared cards with provenance, exactly as context_package_get) and a Knowledge Receipt: cite its receiptId and hash in the task hand-off. "nothing_found" is a valid answer. The receipt holds ids and hashes only; the task text is hashed, never stored. A cloud_model connection first gets confirmationRequired; call again with the transferId once the human confirmed it.',
    inputSchema: schema('knowledge-receipt.schema.json#/$defs/consultRequest'),
    outputSchema: schema('knowledge-receipt.schema.json#/$defs/consultResult'),
    annotations: READ_ONLY,
  },
  {
    name: 'knowledge_write_back',
    title: 'Write back what the task learned',
    description:
      'Call this at the end of every task. Either propose one card with what the task learned (a pending proposal the human accepts or rejects) or state why no card is needed (no_new_knowledge, already_covered with the card ids, ephemeral_ops_fact, task_abandoned). Returns a Write-back Receipt: cite its receiptId and hash in the task hand-off.',
    inputSchema: schema('write-back-receipt.schema.json#/$defs/request'),
    outputSchema: schema('write-back-receipt.schema.json#/$defs/result'),
    annotations: PROPOSES,
  },
  {
    name: 'decision_record',
    title: 'Propose a decision card',
    description:
      'Proposes a decision card with the eleven sections (situation, trigger, conditions, facts, priorities, action, alternatives, exclusions, rationale, cardsUsed, outcome). It is a pending proposal; only a human accepts it.',
    inputSchema: schema('api.schema.json#/$defs/decisionRecordRequest'),
    outputSchema: schema('proposal.schema.json'),
    annotations: PROPOSES,
  },
  {
    name: 'decision_outcome',
    title: 'Propose the outcome of a decision',
    description:
      'Proposes the known outcome of a decision card, bound to the content hash of the version you read. It is a pending proposal; only a human accepts it, and only the outcome section changes.',
    inputSchema: schema('api.schema.json#/$defs/decisionOutcomeRequest'),
    outputSchema: schema('proposal.schema.json'),
    annotations: PROPOSES,
  },
  {
    name: 'memory_route',
    title: 'Route a memory item',
    description:
      'Classifies one item of your memory: card_proposal (durable knowledge; write it back with knowledge_write_back) or ephemeral_ops_fact (keep it in your own memory). Deterministic rules; nothing is stored or logged.',
    inputSchema: schema('memory-route.schema.json#/$defs/request'),
    outputSchema: schema('memory-route.schema.json'),
    annotations: READ_ONLY,
  },
] as const satisfies readonly ToolDefinition[];

export type ToolName = (typeof TOOLS)[number]['name'];
