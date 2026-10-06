// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// GENERATED FILE, DO NOT EDIT. Source: schemas/*.schema.json.
// Regenerate with `pnpm generate:types`; a test fails if this file is out of date.
// The JSON Schemas of schemas/, for runtime validation with Ajv.

/** Every JSON Schema of the contract, keyed by its `$id`. */
export const SCHEMAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'https://worldbuilder.invalid/schemas/v0/api.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/api.schema.json',
    title: 'Api',
    description:
      "Inputs and outputs of the MCP tools and Board API operations that are not domain objects themselves (ADR-0016). Each MCP tool and its HTTP counterpart use the same definitions. Identity, author and disclosure target are never inputs: they come from the caller's registered connection (ADR-0012, ADR-0026).",
    $defs: {
      emptyRequest: {
        title: 'EmptyRequest',
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      worldList: {
        title: 'WorldList',
        type: 'object',
        properties: { worlds: { type: 'array', items: { $ref: 'world.schema.json' } } },
        required: ['worlds'],
        additionalProperties: false,
      },
      lageGetRequest: {
        title: 'LageGetRequest',
        type: 'object',
        properties: { lageId: { $ref: 'common.schema.json#/$defs/cardId' } },
        required: ['lageId'],
        additionalProperties: false,
      },
      lageCreateRequest: {
        title: 'LageCreateRequest',
        description:
          'Body of the human-only lage_create operation: a new Lage card. The store assigns the id; the author is the human.',
        type: 'object',
        properties: {
          title: { $ref: 'common.schema.json#/$defs/text' },
          worlds: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/worldId' },
            uniqueItems: true,
          },
          lage: { $ref: 'lage.schema.json' },
        },
        required: ['title', 'lage'],
        additionalProperties: false,
      },
      cardGetRequest: {
        title: 'CardGetRequest',
        type: 'object',
        properties: { cardId: { $ref: 'common.schema.json#/$defs/cardId' } },
        required: ['cardId'],
        additionalProperties: false,
      },
      cardsSearchRequest: {
        title: 'CardsSearchRequest',
        type: 'object',
        properties: {
          worldId: { $ref: 'common.schema.json#/$defs/worldId' },
          text: { type: 'string', minLength: 1, maxLength: 500 },
          type: { type: 'string', minLength: 1, maxLength: 100 },
          layer: { $ref: 'common.schema.json#/$defs/layer' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          cursor: { $ref: '#/$defs/cursor' },
        },
        additionalProperties: false,
      },
      cardPage: {
        title: 'CardPage',
        description: "Gate-cleared cards for the caller's target; denied cards are omitted.",
        type: 'object',
        properties: {
          cards: { type: 'array', items: { $ref: 'card.schema.json' } },
          nextCursor: { $ref: '#/$defs/cursor' },
          denied: {
            description:
              "Cards the gate withheld for the caller's target, by id and reason (ADR-0031).",
            type: 'array',
            items: { $ref: 'disclosure-decision.schema.json#/$defs/denied' },
          },
        },
        required: ['cards'],
        additionalProperties: false,
      },
      proposalListRequest: {
        title: 'ProposalListRequest',
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'accepted', 'rejected'] },
          lageId: { $ref: 'common.schema.json#/$defs/cardId' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          cursor: { $ref: '#/$defs/cursor' },
          changedSince: {
            description:
              'Polling (ADR-0032): return only proposals created or decided after this opaque cursor. Pass the `nextCursor` of the previous page.',
            $ref: '#/$defs/cursor',
          },
        },
        additionalProperties: false,
      },
      proposalPage: {
        title: 'ProposalPage',
        type: 'object',
        properties: {
          proposals: { type: 'array', items: { $ref: 'proposal.schema.json' } },
          nextCursor: {
            description:
              'Opaque cursor: pass it as `cursor` for the next page or as `changedSince` to poll for later changes.',
            $ref: '#/$defs/cursor',
          },
        },
        required: ['proposals'],
        additionalProperties: false,
      },
      cursor: {
        title: 'Cursor',
        description: 'Opaque pagination cursor.',
        type: 'string',
        minLength: 1,
        maxLength: 512,
      },
      problem: {
        title: 'Problem',
        description: 'Error response (RFC 9457). Never contains card content (ADR-0026).',
        type: 'object',
        properties: {
          type: { type: 'string', format: 'uri-reference' },
          title: { type: 'string' },
          status: { type: 'integer', minimum: 400, maximum: 599 },
          detail: { type: 'string' },
        },
        required: ['title', 'status'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/card.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/card.schema.json',
    title: 'Card',
    description:
      'Canonical card (ADR-0023). Every store maps to this model; card format v2 rules (layer, author, provenance, player fields, Lage, decision sections) apply to format-2 cards (ADR-0007, ADR-0009). Stance data is never part of a card (ADR-0008).',
    type: 'object',
    $ref: '#/$defs/content',
    properties: {
      id: true,
      externalId: true,
      uri: true,
      format: true,
      type: true,
      title: true,
      author: true,
      contentHash: true,
    },
    required: ['id', 'externalId', 'uri', 'format', 'type', 'title', 'author', 'contentHash'],
    $defs: {
      content: {
        title: 'CardContent',
        description:
          'All card fields with the format v2 rules. Shared by Card (identity required) and CardDraft (identity forbidden).',
        type: 'object',
        properties: {
          id: {
            description:
              'Canonical id: minted ULID, or derived from `uri` for stores with their own id scheme (ADR-0023).',
            $ref: 'common.schema.json#/$defs/cardId',
          },
          externalId: {
            description: "The card's id in its home store (store-local).",
            type: 'string',
            minLength: 1,
          },
          uri: {
            description: 'wb:<storeInstanceId>/<externalId>; the home-store reference (ADR-0005).',
            $ref: 'common.schema.json#/$defs/wbUri',
          },
          format: {
            description:
              '1 = legacy card, 2 = card format v2. Cards written by the product are always format 2.',
            type: 'integer',
            enum: [1, 2],
          },
          collection: { $ref: 'common.schema.json#/$defs/collection' },
          type: {
            description:
              'Canonical type; an open vocabulary (actor, person, organisation, evidence, source, claim, event, experience, assumption, rating, decision, rule, topic, lage, ...).',
            $ref: 'common.schema.json#/$defs/text',
          },
          typeRaw: {
            description: "The store's original type value, kept so that a patch never rewrites it.",
            type: 'string',
          },
          title: { $ref: 'common.schema.json#/$defs/text' },
          body: { description: 'Markdown body.', type: 'string' },
          date: { $ref: 'common.schema.json#/$defs/isoDate' },
          source: {
            description: 'Source as text, URI or card id.',
            $ref: 'common.schema.json#/$defs/text',
          },
          sourceDate: { $ref: 'common.schema.json#/$defs/isoDate' },
          sourceChecksum: {
            description:
              'SHA-256 of the original source document (not `contentHash`). Must be SHA-256 on collection evidence.',
            type: 'string',
          },
          contentHash: {
            description:
              'Hash of the canonical card content, computed by the product (ADR-0006, ADR-0034). Required on every card an adapter returns; optional on drafts, where the store recomputes it.',
            $ref: 'common.schema.json#/$defs/contentHash',
          },
          status: { $ref: 'common.schema.json#/$defs/cardStatus' },
          rating: {
            description: 'Carried as stored, without product semantics yet.',
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
          release: { $ref: 'common.schema.json#/$defs/release', default: 'private' },
          carrier: { description: 'Carried as stored.', type: 'string' },
          affiliation: { description: 'Carried as stored.', type: 'string' },
          visibility: { $ref: 'common.schema.json#/$defs/visibility', default: 'private' },
          class: { $ref: 'common.schema.json#/$defs/cardClass' },
          layer: { $ref: 'common.schema.json#/$defs/layer' },
          worlds: {
            description:
              'Worlds this card appears in, by reference; cards are never copied between worlds.',
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/worldId' },
            uniqueItems: true,
          },
          tags: {
            description: 'Free tags; disclosure-gate rules may match them (ADR-0031).',
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/text' },
            uniqueItems: true,
          },
          author: { $ref: 'common.schema.json#/$defs/author' },
          originSystem: {
            description: 'System the content comes from.',
            $ref: 'common.schema.json#/$defs/text',
          },
          training: {
            description: 'Opt-in for training export (ADR-0017).',
            type: 'boolean',
            default: false,
          },
          edges: { type: 'array', items: { $ref: 'edge.schema.json' } },
          interests: { $ref: '#/$defs/playerField' },
          capabilities: { $ref: '#/$defs/playerField' },
          dependencies: { $ref: '#/$defs/playerField' },
          moves: { $ref: '#/$defs/playerField' },
          lage: {
            description: 'Board state; required on cards of type lage.',
            $ref: 'lage.schema.json',
          },
          sections: {
            description:
              'The eleven decision sections; required on format-2 cards of type decision.',
            $ref: '#/$defs/decisionSections',
          },
          rule: {
            description: 'Structured rule; only on cards of type rule.',
            $ref: 'rule.schema.json',
          },
          level: {
            description:
              'Reserved for card tiers (ADR-0007, ADR-0021). Must not be used until an ADR defines it.',
            not: {},
          },
          signature: {
            description:
              'Reserved for an author key-pair signature (ADR-0021). Must not be used until an ADR defines it.',
            not: {},
          },
        },
        allOf: [
          {
            description: 'Format-2 cards have a known author (ADR-0009).',
            if: { properties: { format: { const: 2 } }, required: ['format'] },
            then: { properties: { author: { $ref: 'common.schema.json#/$defs/knownAuthor' } } },
          },
          {
            description: 'Format-2 evidence and actor cards state their layer (ADR-0007).',
            if: {
              properties: { format: { const: 2 }, collection: { enum: ['evidence', 'actors'] } },
              required: ['format', 'collection'],
            },
            then: { properties: { layer: true }, required: ['layer'] },
          },
          {
            description:
              'A layer is a card format v2 field: cards with a layer are format 2 (ADR-0023).',
            if: { properties: { layer: true }, required: ['layer'] },
            then: { properties: { format: { const: 2 } } },
          },
          {
            description: 'Evidenced and said cards need a source or an origin system (ADR-0009).',
            if: { properties: { layer: { enum: ['evidenced', 'said'] } }, required: ['layer'] },
            then: {
              anyOf: [
                { properties: { source: true }, required: ['source'] },
                { properties: { originSystem: true }, required: ['originSystem'] },
              ],
            },
          },
          {
            description: 'Player fields exist only on actor cards (ADR-0023).',
            if: {
              anyOf: [
                { properties: { interests: true }, required: ['interests'] },
                { properties: { capabilities: true }, required: ['capabilities'] },
                { properties: { dependencies: true }, required: ['dependencies'] },
                { properties: { moves: true }, required: ['moves'] },
              ],
            },
            then: { properties: { collection: { const: 'actors' } }, required: ['collection'] },
          },
          {
            description: 'Evidence cards carry a SHA-256 source checksum if any (ADR-0023).',
            if: { properties: { collection: { const: 'evidence' } }, required: ['collection'] },
            then: { properties: { sourceChecksum: { $ref: 'common.schema.json#/$defs/sha256' } } },
          },
          {
            description: 'Cards of type lage carry their board state.',
            if: { properties: { type: { const: 'lage' } }, required: ['type'] },
            then: { properties: { lage: true }, required: ['lage'] },
          },
          {
            description: 'Only cards of type lage carry a board state.',
            if: { properties: { lage: true }, required: ['lage'] },
            then: { properties: { type: { const: 'lage' } } },
          },
          {
            description: 'Format-2 decision cards have all eleven sections (ADR-0017).',
            if: {
              properties: { type: { const: 'decision' }, format: { const: 2 } },
              required: ['type', 'format'],
            },
            then: { properties: { sections: true }, required: ['sections'] },
          },
          {
            description: 'Only decision cards carry decision sections.',
            if: { properties: { sections: true }, required: ['sections'] },
            then: { properties: { type: { const: 'decision' } } },
          },
          {
            description: 'Only rule cards carry a structured rule.',
            if: { properties: { rule: true }, required: ['rule'] },
            then: { properties: { type: { const: 'rule' } } },
          },
        ],
        additionalProperties: false,
      },
      draft: {
        title: 'CardDraft',
        description:
          'A card proposed for creation (proposal kind create_card). Identity is assigned by the store on accept; the author is set by the server from the agent connection, never taken from the payload (ADR-0011).',
        type: 'object',
        $ref: '#/$defs/content',
        properties: {
          format: { type: 'integer', const: 2 },
          id: { not: {} },
          externalId: { not: {} },
          uri: { not: {} },
          author: { not: {} },
          type: true,
          title: true,
        },
        required: ['format', 'type', 'title'],
      },
      playerField: {
        title: 'PlayerField',
        description: 'Player-field entries; each needs a source (ADR-0009).',
        type: 'array',
        items: { $ref: '#/$defs/playerEntry' },
      },
      playerEntry: {
        title: 'PlayerEntry',
        type: 'object',
        properties: {
          text: { $ref: 'common.schema.json#/$defs/text' },
          source: { $ref: 'common.schema.json#/$defs/sourceRef' },
        },
        required: ['text', 'source'],
        additionalProperties: false,
      },
      decisionSections: {
        title: 'DecisionSections',
        description:
          'Exactly eleven sections, none empty (ADR-0017). `cardsUsed` ids must exist; `outcome` is `open` until known.',
        type: 'object',
        properties: {
          situation: { $ref: 'common.schema.json#/$defs/text' },
          trigger: { $ref: 'common.schema.json#/$defs/text' },
          conditions: { $ref: 'common.schema.json#/$defs/text' },
          facts: { $ref: 'common.schema.json#/$defs/text' },
          priorities: { $ref: 'common.schema.json#/$defs/text' },
          action: { $ref: 'common.schema.json#/$defs/text' },
          alternatives: { $ref: 'common.schema.json#/$defs/text' },
          exclusions: { $ref: 'common.schema.json#/$defs/text' },
          rationale: { $ref: 'common.schema.json#/$defs/text' },
          cardsUsed: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardId' },
            minItems: 1,
            uniqueItems: true,
          },
          outcome: { $ref: 'common.schema.json#/$defs/text' },
        },
        required: [
          'situation',
          'trigger',
          'conditions',
          'facts',
          'priorities',
          'action',
          'alternatives',
          'exclusions',
          'rationale',
          'cardsUsed',
          'outcome',
        ],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/common.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/common.schema.json',
    title: 'Common',
    description:
      'Shared definitions for all Worldbuilder contracts (ADR-0023). This file only holds $defs; it validates nothing on its own.',
    $defs: {
      ulid: {
        title: 'Ulid',
        description:
          'A ULID: 26 Crockford base32 characters, upper case. Canonical ids are minted ULIDs or derived from the card URI (first 128 bits of SHA-256(uri), ADR-0023).',
        type: 'string',
        pattern: '^[0-7][0-9A-HJKMNP-TV-Z]{25}$',
      },
      cardId: {
        title: 'CardId',
        description:
          'Canonical card id (ULID). Canonical objects always hold this id, never a store-local id.',
        $ref: '#/$defs/ulid',
      },
      worldId: {
        title: 'WorldId',
        description: 'Canonical world id (ULID).',
        $ref: '#/$defs/ulid',
      },
      uuid: {
        title: 'Uuid',
        description: 'A lower-case RFC 9562 UUID.',
        type: 'string',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      },
      wbUri: {
        title: 'WbUri',
        description:
          "Reference to a card in its home store: wb:<storeInstanceId>/<externalId>, in canonical form only: the external id NFC-normalised, UTF-8, every unreserved character literal and every other byte %XX with upper-case hex (RFC 3986). A URI that differs from buildUri(storeInstanceId, externalId) is not a card URI (for example %2D for '-'). storeInstanceId is a random UUID, never a hostname, path or user name (ADR-0005, ADR-0023).",
        type: 'string',
        pattern:
          '^wb:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$',
      },
      sourceRef: {
        title: 'SourceRef',
        description:
          'A card id or an absolute URI (for example a wb: URI or a web address). Used where provenance must be machine-resolvable, e.g. player fields (ADR-0009).',
        anyOf: [{ $ref: '#/$defs/ulid' }, { type: 'string', format: 'uri' }],
      },
      agentAuthor: {
        title: 'AgentAuthor',
        description: 'An agent identity: agent:<name>.',
        type: 'string',
        pattern: '^agent:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
      },
      humanAuthor: {
        title: 'HumanAuthor',
        description: 'The local human user. Human-only operations record this value.',
        type: 'string',
        const: 'human',
      },
      knownAuthor: {
        title: 'KnownAuthor',
        description: 'human or agent:<name>.',
        type: 'string',
        pattern: '^(?:human|agent:[A-Za-z0-9][A-Za-z0-9._-]{0,63})$',
      },
      author: {
        title: 'Author',
        description:
          'human, agent:<name>, or unknown. unknown is valid only on legacy format-1 cards and on edges read from legacy links (ADR-0009, ADR-0023).',
        type: 'string',
        pattern: '^(?:human|unknown|agent:[A-Za-z0-9][A-Za-z0-9._-]{0,63})$',
      },
      layer: {
        title: 'Layer',
        description:
          'Epistemic kind of a card (ADR-0007). believed is never a layer; it is a private stance (ADR-0008).',
        type: 'string',
        enum: ['evidenced', 'said', 'experience'],
      },
      edgeKind: {
        title: 'EdgeKind',
        description: 'Directed edge kinds of card format v2 (ADR-0023).',
        type: 'string',
        enum: [
          'supports',
          'refutes',
          'represents',
          'cites',
          'based_on',
          'depends_on',
          'relation',
          'unspecified',
        ],
      },
      collection: {
        title: 'Collection',
        description: 'Store collection a card lives in (ADR-0023).',
        type: 'string',
        enum: ['actors', 'evidence', 'decisions'],
      },
      cardStatus: { title: 'CardStatus', type: 'string', enum: ['draft', 'checked', 'released'] },
      release: {
        title: 'Release',
        description: 'Release tier, recorded without behaviour (ADR-0021).',
        type: 'string',
        enum: ['private', 'community', 'commercial'],
      },
      visibility: {
        title: 'Visibility',
        type: 'string',
        enum: ['private', 'company_internal', 'cross_partner', 'customer_visible', 'public'],
      },
      cardClass: {
        title: 'CardClass',
        description: 'Sensitivity class; input to disclosure-gate rules (ADR-0023).',
        type: 'string',
        enum: ['A', 'B', 'C'],
      },
      disclosureTarget: {
        title: 'DisclosureTarget',
        description: 'Where content may go (ADR-0012).',
        type: 'string',
        enum: ['screen', 'local_model', 'cloud_model', 'demo'],
      },
      stancePosition: {
        title: 'StancePosition',
        type: 'string',
        enum: ['believed', 'rejected', 'undecided'],
      },
      probabilityBand: {
        title: 'ProbabilityBand',
        description: 'ICD 203 band keys (ADR-0010).',
        type: 'string',
        enum: [
          'almost_no_chance',
          'very_unlikely',
          'unlikely',
          'roughly_even',
          'likely',
          'very_likely',
          'almost_certain',
        ],
      },
      proposalKind: {
        title: 'ProposalKind',
        type: 'string',
        enum: ['place_card', 'move_card', 'add_edge', 'create_card', 'comment'],
      },
      isoDate: { title: 'IsoDate', type: 'string', format: 'date' },
      dateTime: { title: 'DateTime', type: 'string', format: 'date-time' },
      sha256: {
        title: 'Sha256',
        description: 'Lower-case hex SHA-256 digest.',
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
      },
      contentHash: {
        title: 'ContentHash',
        description:
          'sha256:<lower-case hex> over the RFC 8785 (JCS) serialisation of the hashed card content (ADR-0034).',
        type: 'string',
        pattern: '^sha256:[0-9a-f]{64}$',
      },
      text: {
        title: 'Text',
        description: 'Non-empty text that is not only whitespace.',
        type: 'string',
        minLength: 1,
        pattern: '\\S',
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/context-package.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/context-package.schema.json',
    title: 'ContextPackage',
    description:
      'What a model or agent receives about the active world (ADR-0016, ADR-0024 item 34). Built after the disclosure gate: every item is gate-cleared for `target`; denied cards are omitted and only counted in `withheld`. Layers are never merged into a score. Only accepted content appears as items; pending proposals are listed separately. Stance data appears only for target screen; a cloud_model package carries content only with a confirmed, consumed transfer token.',
    type: 'object',
    properties: {
      id: { $ref: 'common.schema.json#/$defs/ulid' },
      target: { $ref: 'common.schema.json#/$defs/disclosureTarget' },
      worldId: { $ref: 'common.schema.json#/$defs/worldId' },
      lageId: { $ref: 'common.schema.json#/$defs/cardId' },
      question: { $ref: 'common.schema.json#/$defs/text' },
      createdAt: { $ref: 'common.schema.json#/$defs/dateTime' },
      items: { type: 'array', items: { $ref: '#/$defs/item' } },
      independence: { $ref: '#/$defs/independence' },
      pendingProposals: {
        description:
          'Proposals that have not been accepted. Never facts; listed only in this section (ADR-0011).',
        type: 'array',
        items: { $ref: '#/$defs/pendingProposal' },
      },
      withheld: {
        description: 'Number of cards the gate denied for this target.',
        type: 'integer',
        minimum: 0,
      },
      transfer: {
        description:
          'The confirmed transfer whose objects this package carries; its cardIds list every item.',
        $ref: 'disclosure-decision.schema.json#/$defs/confirmationRef',
      },
      denied: {
        description:
          'Cards the gate withheld, by id and reason. A cloud_model package without a confirmed transfer contains only these (ADR-0031).',
        type: 'array',
        items: { $ref: 'disclosure-decision.schema.json#/$defs/denied' },
      },
      confirmationRequired: {
        description:
          'Set when a cloud_model caller asked without a confirmed transfer: the human must confirm transfer `transferId` on the board; the caller then asks again with that transferId. The package then has no content.',
        type: 'object',
        properties: { transferId: { $ref: 'common.schema.json#/$defs/ulid' } },
        required: ['transferId'],
        additionalProperties: false,
      },
    },
    required: [
      'id',
      'target',
      'worldId',
      'createdAt',
      'items',
      'independence',
      'pendingProposals',
      'withheld',
    ],
    additionalProperties: false,
    allOf: [
      {
        description: 'Stance data never leaves the screen (ADR-0008, ADR-0012).',
        if: { properties: { target: { const: 'screen' } }, required: ['target'] },
        else: {
          properties: {
            items: { type: 'array', items: { type: 'object', properties: { stance: false } } },
          },
        },
      },
      {
        description:
          'A cloud_model package carries content only from a confirmed, released transfer (ADR-0031, ADR-0028); without one it has no items, no question and no pending proposals, only denied ids and possibly confirmationRequired.',
        if: { properties: { target: { const: 'cloud_model' } }, required: ['target'] },
        then: {
          anyOf: [
            { properties: { transfer: true }, required: ['transfer'] },
            {
              properties: {
                items: { type: 'array', maxItems: 0 },
                pendingProposals: { type: 'array', maxItems: 0 },
                question: false,
              },
            },
          ],
        },
        else: {
          not: {
            anyOf: [
              { properties: { transfer: true }, required: ['transfer'] },
              { properties: { confirmationRequired: true }, required: ['confirmationRequired'] },
            ],
          },
        },
      },
    ],
    $defs: {
      item: {
        title: 'ContextItem',
        type: 'object',
        properties: {
          card: {
            description:
              'The canonical card, serialised after the gate decision (never a raw store file).',
            $ref: 'card.schema.json',
          },
          provenance: { $ref: '#/$defs/provenance' },
          gate: { $ref: '#/$defs/gate' },
          stance: {
            description: "The user's stance; only in packages for target screen.",
            $ref: 'stance.schema.json',
          },
        },
        required: ['card', 'provenance', 'gate'],
        additionalProperties: false,
        description:
          'One card for the target, with its provenance and gate decision. Layer and author are those of the card; a card without a layer is unclassified (ADR-0007).',
      },
      provenance: {
        title: 'ContextProvenance',
        description:
          'Where the card comes from and which independent origin it belongs to (ADR-0009).',
        type: 'object',
        properties: {
          uri: { $ref: 'common.schema.json#/$defs/wbUri' },
          source: { $ref: 'common.schema.json#/$defs/text' },
          sourceDate: { $ref: 'common.schema.json#/$defs/isoDate' },
          originSystem: { $ref: 'common.schema.json#/$defs/text' },
          originRoot: {
            description:
              'Identity of the origin root reached by following cites/based_on edges and source identity: a card id, source URI or content hash.',
            $ref: 'common.schema.json#/$defs/text',
          },
          originKnown: {
            description:
              'False if the origin could not be traced; such a card counts as its own root and is flagged.',
            type: 'boolean',
          },
        },
        required: ['uri', 'originRoot', 'originKnown'],
        additionalProperties: false,
      },
      gate: {
        title: 'ContextGate',
        description:
          'The gate decision for this item and target. Items are always allowed; denied cards never appear.',
        type: 'object',
        properties: {
          decision: { type: 'string', const: 'allow' },
          reason: { $ref: 'common.schema.json#/$defs/text' },
        },
        required: ['decision', 'reason'],
        additionalProperties: false,
      },
      independence: {
        title: 'ContextIndependence',
        description: "'N findings · M origins' over the items; never a bare card count.",
        type: 'object',
        properties: {
          findings: { type: 'integer', minimum: 0 },
          origins: { type: 'integer', minimum: 0 },
        },
        required: ['findings', 'origins'],
        additionalProperties: false,
      },
      pendingProposal: {
        title: 'ContextPendingProposal',
        type: 'object',
        properties: {
          proposalId: { $ref: 'common.schema.json#/$defs/ulid' },
          kind: { $ref: 'common.schema.json#/$defs/proposalKind' },
        },
        required: ['proposalId', 'kind'],
        additionalProperties: false,
        description:
          'A pending proposal, by id and kind only: no free text from agents reaches a model as context.',
      },
      request: {
        title: 'ContextPackageRequest',
        description:
          "Input of context_package_get. The target is taken from the caller's registered connection, never from the request (ADR-0012). A board send to a cloud model carries the transferId and the confirmation token; an MCP connection registered as cloud_model carries only the transferId of the transfer the human confirmed, and the service releases it to that connection (ADR-0031, ADR-0028).",
        type: 'object',
        properties: {
          worldId: { $ref: 'common.schema.json#/$defs/worldId' },
          lageId: { $ref: 'common.schema.json#/$defs/cardId' },
          question: { $ref: 'common.schema.json#/$defs/text' },
          maxItems: { type: 'integer', minimum: 1, maximum: 500 },
          transferId: { $ref: 'common.schema.json#/$defs/ulid' },
          confirmationToken: { $ref: 'disclosure-decision.schema.json#/$defs/confirmationToken' },
        },
        required: ['worldId'],
        additionalProperties: false,
        dependentRequired: { confirmationToken: ['transferId'] },
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/decision.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/decision.schema.json',
    title: 'Decision',
    description:
      'A decision card: a format-2 card of type decision with exactly eleven non-empty sections (ADR-0017). Saving one is a human-only operation (ADR-0016).',
    type: 'object',
    $ref: 'card.schema.json',
    properties: {
      type: { type: 'string', const: 'decision' },
      format: { type: 'integer', const: 2 },
      sections: { $ref: 'card.schema.json#/$defs/decisionSections' },
    },
    required: ['sections'],
    $defs: {
      draft: {
        title: 'DecisionDraft',
        description:
          'Body of the human-only decision create operation: a decision card without identity or author (the store assigns the id; the author is the human).',
        type: 'object',
        $ref: 'card.schema.json#/$defs/draft',
        properties: {
          type: { type: 'string', const: 'decision' },
          sections: { $ref: 'card.schema.json#/$defs/decisionSections' },
        },
        required: ['type', 'sections'],
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/disclosure-decision.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/disclosure-decision.schema.json',
    title: 'DisclosureDecision',
    description:
      "Result of DisclosureGate.decide(card, target) (ADR-0012). Default deny: without a matching allow rule the decision is deny. An allow for cloud_model is only valid with the user's per-transfer confirmation. Stance data is allowed for target screen only. Decisions are logged without card content.",
    type: 'object',
    properties: {
      subject: { $ref: '#/$defs/subject' },
      target: { $ref: 'common.schema.json#/$defs/disclosureTarget' },
      decision: { type: 'string', enum: ['allow', 'deny'] },
      reason: { $ref: 'common.schema.json#/$defs/text' },
      ruleId: {
        description:
          'Id of the rule that decided: the matching deny rule, or else the matching allow rule. Absent for default deny.',
        type: 'string',
        minLength: 1,
      },
      confirmationRequired: {
        description:
          'True when the decision is deny only because the per-transfer confirmation is missing.',
        type: 'boolean',
      },
      confirmation: { $ref: '#/$defs/confirmationRef' },
      decidedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
    },
    required: ['subject', 'target', 'decision', 'reason', 'decidedAt'],
    additionalProperties: false,
    allOf: [
      {
        description: 'cloud_model requires a per-transfer confirmation for every allow.',
        if: {
          properties: { target: { const: 'cloud_model' }, decision: { const: 'allow' } },
          required: ['target', 'decision'],
        },
        then: { properties: { confirmation: true }, required: ['confirmation'] },
      },
      {
        description: 'Confirmations exist only for cloud_model transfers.',
        if: { properties: { confirmation: true }, required: ['confirmation'] },
        then: { properties: { target: { const: 'cloud_model' } } },
      },
      {
        description: 'Stance data never leaves the screen (ADR-0008).',
        if: {
          properties: {
            subject: {
              type: 'object',
              properties: { kind: { const: 'stance' } },
              required: ['kind'],
            },
            decision: { const: 'allow' },
          },
          required: ['subject', 'decision'],
        },
        then: { properties: { target: { const: 'screen' } } },
      },
    ],
    $defs: {
      subject: {
        title: 'DisclosureSubject',
        description: "What is being disclosed: a card, or the user's stance data on a card.",
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['card', 'stance'] },
          cardId: { $ref: 'common.schema.json#/$defs/cardId' },
        },
        required: ['kind', 'cardId'],
        additionalProperties: false,
      },
      transfer: {
        title: 'DisclosureTransfer',
        description:
          "A previewed cloud_model transfer awaiting the user's confirmation (ADR-0012, ADR-0031). The record lives in memory on the service, expires 5 minutes after the preview, and is void after a restart. `cardIds` lists the ids of the objects in the envelope; `payloadHash` must be echoed by the confirmation.",
        type: 'object',
        properties: {
          transferId: { $ref: 'common.schema.json#/$defs/ulid' },
          purpose: { type: 'string', enum: ['context_package', 'level1', 'export'] },
          cardIds: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardId' },
            minItems: 1,
            uniqueItems: true,
          },
          payloadHash: { $ref: '#/$defs/payloadHash' },
          preview: { $ref: '#/$defs/previewEnvelope' },
          createdAt: { $ref: 'common.schema.json#/$defs/dateTime' },
          expiresAt: { $ref: 'common.schema.json#/$defs/dateTime' },
          requestedBy: {
            description:
              'Who will send: the board session (token flow) or a registered MCP connection (released to that connection only).',
            type: 'string',
            enum: ['board', 'mcp_connection'],
          },
        },
        required: [
          'transferId',
          'purpose',
          'cardIds',
          'payloadHash',
          'preview',
          'createdAt',
          'expiresAt',
          'requestedBy',
        ],
        additionalProperties: false,
      },
      confirmRequest: {
        title: 'DisclosureConfirmRequest',
        description:
          'Body of the human-only confirm operation (the transferId is in the path). The service rejects a payloadHash that differs from the stored one or from the hash of the current envelope, and a second confirmation (409), and an expired transfer (410).',
        type: 'object',
        properties: { payloadHash: { $ref: '#/$defs/payloadHash' } },
        required: ['payloadHash'],
        additionalProperties: false,
      },
      confirmation: {
        title: 'DisclosureConfirmation',
        description:
          'Response of the human-only confirm operation (ADR-0031, ADR-0028). For a transfer the board previewed for its own send, it carries a single-use token (at least 128 random bits, held server side, bound to the confirming human session, valid 5 minutes, void after a restart) that the send call carries; the service consumes it atomically before sending. For a transfer an MCP connection registered as cloud_model asked for, there is no token: the agent re-calls with the transferId and the service releases the content to that connection only. Never logged.',
        type: 'object',
        properties: {
          transferId: { $ref: 'common.schema.json#/$defs/ulid' },
          payloadHash: { $ref: '#/$defs/payloadHash' },
          cardIds: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardId' },
            minItems: 1,
            uniqueItems: true,
          },
          token: { $ref: '#/$defs/confirmationToken' },
          tokenExpiresAt: { $ref: 'common.schema.json#/$defs/dateTime' },
          confirmedBy: { $ref: 'common.schema.json#/$defs/humanAuthor' },
          confirmedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
        },
        required: ['transferId', 'payloadHash', 'cardIds', 'confirmedBy', 'confirmedAt'],
        additionalProperties: false,
        dependentRequired: { token: ['tokenExpiresAt'] },
      },
      payloadHash: {
        title: 'PayloadHash',
        description:
          'sha256:<lower-case hex> over the RFC 8785 (JCS) serialisation of the preview envelope (ADR-0031, ADR-0034).',
        type: 'string',
        pattern: '^sha256:[0-9a-f]{64}$',
      },
      modelRequest: {
        title: 'DisclosureModelRequest',
        description: 'The request parameters that go to the model with the objects.',
        type: 'object',
        properties: {
          question: { $ref: 'common.schema.json#/$defs/text' },
          options: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/text' },
            uniqueItems: true,
          },
          outputSchema: {
            description: 'JSON Schema the answer must follow (level 1).',
            type: 'object',
          },
        },
        additionalProperties: false,
      },
      previewEnvelope: {
        title: 'DisclosurePreviewEnvelope',
        description:
          'Exactly what would leave the device: the target, the connector, the request parameters and the canonical objects after the gate decision. The payload hash covers this envelope.',
        type: 'object',
        properties: {
          target: { type: 'string', const: 'cloud_model' },
          connectorId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
          request: { $ref: '#/$defs/modelRequest' },
          objects: { type: 'array', items: { $ref: 'card.schema.json' }, minItems: 1 },
        },
        required: ['target', 'connectorId', 'request', 'objects'],
        additionalProperties: false,
      },
      previewRequest: {
        title: 'DisclosurePreviewRequest',
        description:
          'Body of the human-only preview operation: what the user wants to send. The server builds the envelope from gate-cleared canonical objects only.',
        type: 'object',
        properties: {
          connectorId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
          purpose: { type: 'string', enum: ['context_package', 'level1', 'export'] },
          request: { $ref: '#/$defs/modelRequest' },
          cardIds: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardId' },
            minItems: 1,
            uniqueItems: true,
          },
        },
        required: ['connectorId', 'purpose', 'request', 'cardIds'],
        additionalProperties: false,
      },
      confirmationToken: {
        title: 'ConfirmationToken',
        description: 'Opaque single-use token, base64url of at least 16 random bytes (128 bits).',
        type: 'string',
        pattern: '^[A-Za-z0-9_-]{22,128}$',
        maxLength: 128,
      },
      confirmationRef: {
        title: 'DisclosureConfirmationRef',
        description:
          'Reference to a confirmed transfer whose token was consumed for this send; recorded in gate decisions and context packages. Contains no token.',
        type: 'object',
        properties: {
          transferId: { $ref: 'common.schema.json#/$defs/ulid' },
          payloadHash: { $ref: '#/$defs/payloadHash' },
          cardIds: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardId' },
            minItems: 1,
            uniqueItems: true,
          },
          confirmedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
        },
        required: ['transferId', 'payloadHash', 'cardIds', 'confirmedAt'],
        additionalProperties: false,
      },
      denied: {
        title: 'DeniedCard',
        description:
          'A card the gate withheld from this response, with the reason; never its content.',
        type: 'object',
        properties: {
          cardId: { $ref: 'common.schema.json#/$defs/cardId' },
          reason: { $ref: 'common.schema.json#/$defs/text' },
        },
        required: ['cardId', 'reason'],
        additionalProperties: false,
      },
      release: {
        title: 'DisclosureRelease',
        description:
          'Result of consuming a confirmation for one send (DisclosureGate.redeem): exactly the canonical objects the human confirmed, nothing else. Cloud content leaves the device only as these objects.',
        type: 'object',
        properties: {
          confirmation: { $ref: '#/$defs/confirmationRef' },
          objects: { type: 'array', items: { $ref: 'card.schema.json' }, minItems: 1 },
        },
        required: ['confirmation', 'objects'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/edge.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/edge.schema.json',
    title: 'Edge',
    description:
      'A directed, typed edge from the card that holds it to `target` (ADR-0023). `by` records who drew it (ADR-0009); `unknown` only for edges read from legacy links.',
    type: 'object',
    properties: {
      target: { $ref: 'common.schema.json#/$defs/cardId' },
      kind: { $ref: 'common.schema.json#/$defs/edgeKind' },
      by: { $ref: 'common.schema.json#/$defs/author' },
    },
    required: ['target', 'kind', 'by'],
    additionalProperties: false,
  },
  'https://worldbuilder.invalid/schemas/v0/finding.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/finding.schema.json',
    title: 'Finding',
    description:
      'A new finding reported by a SourceConnector (ADR-0014). It is a reference with provenance, not content we ingest; nothing in the inbox is part of a world until a human pins it (reference-then-pin).',
    type: 'object',
    properties: {
      uri: {
        description: 'Where the finding lives in its home system.',
        type: 'string',
        format: 'uri',
      },
      connector: {
        description: 'Id of the reporting SourceConnector.',
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9._-]{0,63}$',
      },
      title: { $ref: 'common.schema.json#/$defs/text' },
      snippet: {
        description: 'Minimal display text; never the full third-party content.',
        type: 'string',
        maxLength: 1000,
      },
      source: { $ref: 'common.schema.json#/$defs/text' },
      sourceDate: { $ref: 'common.schema.json#/$defs/isoDate' },
      originSystem: { $ref: 'common.schema.json#/$defs/text' },
      retrievedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
    },
    required: ['uri', 'connector', 'title', 'retrievedAt'],
    additionalProperties: false,
    anyOf: [
      { properties: { source: true }, required: ['source'] },
      { properties: { originSystem: true }, required: ['originSystem'] },
    ],
  },
  'https://worldbuilder.invalid/schemas/v0/gate-rules.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/gate-rules.schema.json',
    title: 'GateRules',
    description:
      "Disclosure-gate configuration (ADR-0012, ADR-0031): the user's rule file (`<state>/gate-rules.yaml`), with allow and deny rules per target. A card is allowed for a target only if at least one allow rule matches it and no deny rule does: deny wins, and without a matching allow rule the decision is deny. Rules match card fields only; nothing matches stance data, which stays on the screen whatever the rules say (ADR-0008).",
    type: 'object',
    properties: { rules: { type: 'array', items: { $ref: '#/$defs/rule' } } },
    required: ['rules'],
    additionalProperties: false,
    $defs: {
      rule: {
        title: 'GateRule',
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
          effect: { type: 'string', enum: ['allow', 'deny'] },
          targets: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/disclosureTarget' },
            minItems: 1,
            uniqueItems: true,
          },
          match: { $ref: '#/$defs/match' },
          description: { type: 'string' },
        },
        required: ['id', 'effect', 'targets', 'match'],
        additionalProperties: false,
      },
      match: {
        title: 'GateMatch',
        description:
          'All given criteria must hold (AND); within one criterion any listed value matches (OR). An empty match matches every card.',
        type: 'object',
        properties: {
          visibility: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/visibility' },
            minItems: 1,
            uniqueItems: true,
          },
          class: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardClass' },
            minItems: 1,
            uniqueItems: true,
          },
          collection: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/collection' },
            minItems: 1,
            uniqueItems: true,
          },
          worlds: {
            description: 'Matches if the card appears in any of these worlds, given by name or id.',
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/text' },
            minItems: 1,
            uniqueItems: true,
          },
          type: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/text' },
            minItems: 1,
            uniqueItems: true,
          },
          tags: {
            description: 'Matches if the card has any of these tags.',
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/text' },
            minItems: 1,
            uniqueItems: true,
          },
          ids: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardId' },
            minItems: 1,
            uniqueItems: true,
          },
          syntheticStore: {
            description:
              'Matches cards of a store whose configuration says synthetic: true (demo clearance, ADR-0028).',
            type: 'boolean',
            const: true,
          },
        },
        additionalProperties: false,
      },
      fragment: {
        title: 'GateRuleFragment',
        description:
          'Rules supplied by an adapter for its sensitive classes (ADR-0031). Deny rules only: a fragment with an allow rule is rejected at load time, so an adapter can only narrow what leaves the device.',
        type: 'object',
        properties: {
          source: {
            description: 'The adapter that supplies the fragment.',
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9._@/-]{0,127}$',
          },
          rules: {
            type: 'array',
            items: {
              allOf: [
                { $ref: '#/$defs/rule' },
                { type: 'object', properties: { effect: { type: 'string', const: 'deny' } } },
              ],
            },
          },
        },
        required: ['source', 'rules'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/lage.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/lage.schema.json',
    title: 'Lage',
    description:
      'Board state of a Lage (a card of type `lage`). Stored as a JSON block in the card body; a rewrite archives the previous version (ADR-0006, ADR-0023). Only the Lage format is persisted, never canvas-library state (ADR-0019).',
    type: 'object',
    properties: {
      question: {
        description: 'The guiding question of the Lage (required).',
        $ref: 'common.schema.json#/$defs/text',
      },
      options: {
        description: 'The options under consideration.',
        type: 'array',
        items: { $ref: 'common.schema.json#/$defs/text' },
        uniqueItems: true,
      },
      cards: {
        description: 'Cards placed on the board with their positions.',
        type: 'array',
        items: { $ref: '#/$defs/placement' },
      },
      seats: {
        description: 'Players at the table: humans and agents.',
        type: 'array',
        items: { $ref: '#/$defs/seat' },
      },
      edges: {
        description: 'Edges drawn on this board.',
        type: 'array',
        items: { $ref: '#/$defs/lageEdge' },
      },
      version: {
        description:
          'Version number of this state; increases on every rewrite. Used for optimistic concurrency.',
        type: 'integer',
        minimum: 1,
      },
      updatedAt: {
        description: 'Time (or date, as some stores record it) of the last change.',
        type: 'string',
        anyOf: [{ format: 'date-time' }, { format: 'date' }],
      },
    },
    required: ['question', 'options', 'cards', 'seats', 'edges', 'version', 'updatedAt'],
    additionalProperties: false,
    $defs: {
      placement: {
        title: 'LagePlacement',
        type: 'object',
        properties: {
          id: { $ref: 'common.schema.json#/$defs/cardId' },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['id', 'x', 'y'],
        additionalProperties: false,
      },
      seat: {
        title: 'LageSeat',
        type: 'object',
        properties: {
          name: { $ref: 'common.schema.json#/$defs/text' },
          kind: { type: 'string', enum: ['human', 'agent'] },
        },
        required: ['name', 'kind'],
        additionalProperties: false,
      },
      lageEdge: {
        title: 'LageEdge',
        type: 'object',
        properties: {
          from: { $ref: 'common.schema.json#/$defs/cardId' },
          to: { $ref: 'common.schema.json#/$defs/cardId' },
          kind: { $ref: 'common.schema.json#/$defs/edgeKind' },
          by: { $ref: 'common.schema.json#/$defs/knownAuthor' },
        },
        required: ['from', 'to', 'kind', 'by'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/level1-answer.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/level1-answer.schema.json',
    title: 'Level1Answer',
    description:
      "A fast, typed level-1 answer (ADR-0015). It is an attributed engine estimate ('<engine> estimates 0.82 for X'), never a verdict: it does not count as a decision, does not trigger rules and does not enter statistics. `choice` is one of `options`. World changes it implies arrive as proposals by agent:<engine>.",
    type: 'object',
    properties: {
      id: { $ref: 'common.schema.json#/$defs/ulid' },
      engine: {
        description: 'Engine name, e.g. local-rules, a local model, or the Jev connector.',
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9._-]{0,63}$',
      },
      question: { $ref: 'common.schema.json#/$defs/text' },
      options: {
        description: 'The closed set of options (the enum of the output schema).',
        type: 'array',
        items: { $ref: 'common.schema.json#/$defs/text' },
        minItems: 2,
        uniqueItems: true,
      },
      choice: { description: 'One of `options`.', $ref: 'common.schema.json#/$defs/text' },
      confidence: {
        description:
          "The engine's own confidence for `choice`, shown attributed to the engine. Not an ICD 203 estimate.",
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      inputs: {
        description: 'Cards and rules the engine received (after the disclosure gate).',
        type: 'array',
        items: { $ref: '#/$defs/input' },
      },
      answeredAt: { $ref: 'common.schema.json#/$defs/dateTime' },
    },
    required: ['engine', 'question', 'options', 'choice', 'confidence', 'inputs', 'answeredAt'],
    additionalProperties: false,
    $defs: {
      input: {
        title: 'Level1Input',
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['card', 'rule'] },
          id: { $ref: 'common.schema.json#/$defs/cardId' },
        },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
      request: {
        title: 'Level1Request',
        description:
          'What a ModelConnector receives for a level-1 decision: the question, the closed options, and gate-cleared inputs.',
        type: 'object',
        properties: {
          question: { $ref: 'common.schema.json#/$defs/text' },
          options: {
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/text' },
            minItems: 2,
            uniqueItems: true,
          },
          inputs: { type: 'array', items: { $ref: '#/$defs/input' } },
        },
        required: ['question', 'options', 'inputs'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/prediction.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/prediction.schema.json',
    title: 'Prediction',
    description:
      "An estimative statement found on a card (ADR-0010). Stores the source's original `phrase` verbatim and the mapped ICD 203 `band` (almost_no_chance 1-5 %, very_unlikely 5-20 %, unlikely 20-45 %, roughly_even 45-55 %, likely 55-80 %, very_likely 80-95 %, almost_certain 95-99 %). A number is stored only if the source stated one. The UI shows words. Mappings are made by a human or a deterministic lookup table; an agent's mapping is a proposal.",
    type: 'object',
    properties: {
      id: { $ref: 'common.schema.json#/$defs/ulid' },
      cardId: {
        description: 'The card that contains the estimate.',
        $ref: 'common.schema.json#/$defs/cardId',
      },
      statement: { description: 'What is estimated.', $ref: 'common.schema.json#/$defs/text' },
      phrase: {
        description: "The source's wording, verbatim, any language.",
        $ref: 'common.schema.json#/$defs/text',
      },
      language: {
        description: 'BCP 47 language tag of the phrase.',
        type: 'string',
        pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$',
      },
      band: { $ref: 'common.schema.json#/$defs/probabilityBand' },
      mappedBy: {
        description: 'human, or lookup:<table> for a deterministic lookup table. Never an agent.',
        type: 'string',
        pattern: '^(?:human|lookup:[a-z0-9][a-z0-9-]{0,63})$',
      },
      statedProbability: {
        description: 'Only if the source itself stated a number, as a fraction.',
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      resolveBy: { $ref: 'common.schema.json#/$defs/isoDate' },
      resolution: { $ref: '#/$defs/resolution' },
    },
    required: ['id', 'cardId', 'statement', 'phrase'],
    additionalProperties: false,
    allOf: [
      {
        description: 'A mapped band records who or what mapped it.',
        if: { properties: { band: true }, required: ['band'] },
        then: { properties: { mappedBy: true }, required: ['mappedBy'] },
      },
    ],
    $defs: {
      resolution: {
        title: 'PredictionResolution',
        description: 'Recorded through the outcome loop by a human (ADR-0017).',
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['occurred', 'did_not_occur', 'undeterminable'] },
          resolvedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
          decisionId: { $ref: 'common.schema.json#/$defs/cardId' },
          resolvedBy: { $ref: 'common.schema.json#/$defs/humanAuthor' },
        },
        required: ['outcome', 'resolvedAt', 'resolvedBy'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/proposal.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/proposal.schema.json',
    title: 'Proposal',
    description:
      "An agent move (ADR-0011). `proposal_create` is the only write path for agents; the server sets `id`, `author` (from the connection's agent identity), `status` and `createdAt`. Accept and reject are human-only. Pending or rejected proposals never count anywhere.",
    type: 'object',
    $ref: '#/$defs/kindPayload',
    properties: {
      id: { $ref: 'common.schema.json#/$defs/ulid' },
      author: { $ref: 'common.schema.json#/$defs/agentAuthor' },
      kind: { $ref: 'common.schema.json#/$defs/proposalKind' },
      payload: { type: 'object' },
      rationale: { description: 'Why the agent proposes this.', type: 'string' },
      status: { type: 'string', enum: ['pending', 'accepted', 'rejected'] },
      createdAt: { $ref: 'common.schema.json#/$defs/dateTime' },
      decidedBy: {
        description: 'Who accepted or rejected: always the human (human-only operation).',
        $ref: 'common.schema.json#/$defs/humanAuthor',
      },
      decidedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
    },
    required: ['id', 'author', 'kind', 'payload', 'status', 'createdAt'],
    additionalProperties: false,
    allOf: [
      {
        description: 'A pending proposal has no decision; a decided one records who and when.',
        if: { properties: { status: { const: 'pending' } }, required: ['status'] },
        then: {
          not: {
            anyOf: [
              { properties: { decidedBy: true }, required: ['decidedBy'] },
              { properties: { decidedAt: true }, required: ['decidedAt'] },
            ],
          },
        },
        else: {
          properties: { decidedBy: true, decidedAt: true },
          required: ['decidedBy', 'decidedAt'],
        },
      },
    ],
    $defs: {
      create: {
        title: 'ProposalCreate',
        description:
          'Input of proposal_create. Contains no author, id or status; the server sets them.',
        type: 'object',
        $ref: '#/$defs/kindPayload',
        properties: {
          kind: { $ref: 'common.schema.json#/$defs/proposalKind' },
          payload: { type: 'object' },
          rationale: { type: 'string' },
        },
        required: ['kind', 'payload'],
        additionalProperties: false,
      },
      decide: {
        title: 'ProposalDecide',
        description: 'Body of the human-only accept or reject operation.',
        type: 'object',
        properties: { note: { type: 'string' } },
        additionalProperties: false,
      },
      kindPayload: {
        title: 'ProposalKindPayload',
        description: 'The payload shape is fixed by `kind`.',
        type: 'object',
        allOf: [
          {
            if: { properties: { kind: { const: 'place_card' } }, required: ['kind'] },
            then: { properties: { payload: { $ref: '#/$defs/placeCard' } } },
          },
          {
            if: { properties: { kind: { const: 'move_card' } }, required: ['kind'] },
            then: { properties: { payload: { $ref: '#/$defs/moveCard' } } },
          },
          {
            if: { properties: { kind: { const: 'add_edge' } }, required: ['kind'] },
            then: { properties: { payload: { $ref: '#/$defs/addEdge' } } },
          },
          {
            if: { properties: { kind: { const: 'create_card' } }, required: ['kind'] },
            then: { properties: { payload: { $ref: '#/$defs/createCard' } } },
          },
          {
            if: { properties: { kind: { const: 'comment' } }, required: ['kind'] },
            then: { properties: { payload: { $ref: '#/$defs/comment' } } },
          },
        ],
      },
      placeCard: {
        title: 'PlaceCardPayload',
        description: 'Place an existing card on a Lage.',
        type: 'object',
        properties: {
          lageId: { $ref: 'common.schema.json#/$defs/cardId' },
          cardId: { $ref: 'common.schema.json#/$defs/cardId' },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['lageId', 'cardId', 'x', 'y'],
        additionalProperties: false,
      },
      moveCard: {
        title: 'MoveCardPayload',
        description: 'Move a card that is already on a Lage.',
        type: 'object',
        properties: {
          lageId: { $ref: 'common.schema.json#/$defs/cardId' },
          cardId: { $ref: 'common.schema.json#/$defs/cardId' },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['lageId', 'cardId', 'x', 'y'],
        additionalProperties: false,
      },
      addEdge: {
        title: 'AddEdgePayload',
        description:
          'Draw an edge: on a Lage if `lageId` is given, otherwise as a card edge on `from`. `by` becomes the proposal author on accept.',
        type: 'object',
        properties: {
          lageId: { $ref: 'common.schema.json#/$defs/cardId' },
          from: { $ref: 'common.schema.json#/$defs/cardId' },
          to: { $ref: 'common.schema.json#/$defs/cardId' },
          kind: { $ref: 'common.schema.json#/$defs/edgeKind' },
        },
        required: ['from', 'to', 'kind'],
        additionalProperties: false,
      },
      createCard: {
        title: 'CreateCardPayload',
        description:
          'Create a new card (for example a reference card for a finding, ADR-0014), optionally placed on a Lage.',
        type: 'object',
        properties: {
          card: { $ref: 'card.schema.json#/$defs/draft' },
          lageId: { $ref: 'common.schema.json#/$defs/cardId' },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['card'],
        additionalProperties: false,
        dependentRequired: { lageId: ['x', 'y'] },
      },
      comment: {
        title: 'CommentPayload',
        type: 'object',
        properties: {
          text: { $ref: 'common.schema.json#/$defs/text' },
          cardId: { $ref: 'common.schema.json#/$defs/cardId' },
          lageId: { $ref: 'common.schema.json#/$defs/cardId' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/rule-evaluation.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/rule-evaluation.schema.json',
    title: 'RuleEvaluation',
    description:
      'Result of rules_evaluate for one Lage and one disclosure target (ADR-0013). Lists which rules fire and why. There is deliberately no percentage, score, ratio, aggregate, net value or recommended option, and no field may be added for one. Only accepted cards trigger rules. For non-screen targets, rules with a stance-dependent condition or a condition on a card not cleared for the target are omitted and only counted in `withheld`.',
    type: 'object',
    properties: {
      lageId: { $ref: 'common.schema.json#/$defs/cardId' },
      lageVersion: { type: 'integer', minimum: 1 },
      target: { $ref: 'common.schema.json#/$defs/disclosureTarget' },
      evaluatedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
      results: { type: 'array', items: { $ref: '#/$defs/result' } },
      withheld: {
        description: 'Number of rules omitted for this target. Always 0 for target screen.',
        type: 'integer',
        minimum: 0,
      },
    },
    required: ['lageId', 'lageVersion', 'target', 'evaluatedAt', 'results', 'withheld'],
    additionalProperties: false,
    allOf: [
      {
        description:
          'Nothing is withheld from the screen; for any other target no returned rule has a stance-dependent condition (ADR-0013).',
        if: { properties: { target: { const: 'screen' } }, required: ['target'] },
        then: { properties: { withheld: { const: 0 } } },
        else: {
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rule: {
                    type: 'object',
                    properties: {
                      when: {
                        type: 'array',
                        items: {
                          not: {
                            type: 'object',
                            properties: { kind: { const: 'stance' } },
                            required: ['kind'],
                          },
                        },
                      },
                      unless: {
                        type: 'array',
                        items: {
                          not: {
                            type: 'object',
                            properties: { kind: { const: 'stance' } },
                            required: ['kind'],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
    $defs: {
      result: {
        title: 'RuleResult',
        type: 'object',
        properties: {
          ruleId: { description: 'Id of the rule card.', $ref: 'common.schema.json#/$defs/cardId' },
          fired: { type: 'boolean' },
          triggeringCardIds: {
            description:
              'Accepted cards that satisfied the conditions, filtered by the gate for the target.',
            type: 'array',
            items: { $ref: 'common.schema.json#/$defs/cardId' },
            uniqueItems: true,
          },
          unmet: {
            description: 'Conditions that were evaluated and did not hold.',
            type: 'array',
            items: { $ref: '#/$defs/conditionRef' },
          },
          unknown: {
            description:
              'Conditions that could not be evaluated (for example a referenced card is missing).',
            type: 'array',
            items: { $ref: '#/$defs/conditionRef' },
          },
          rule: {
            description:
              'The rule text; included only if the rule card itself is cleared for the target.',
            $ref: 'rule.schema.json',
          },
        },
        required: ['ruleId', 'fired', 'triggeringCardIds', 'unmet', 'unknown'],
        additionalProperties: false,
      },
      conditionRef: {
        title: 'RuleConditionRef',
        description: 'Points at one condition of the rule by clause and position.',
        type: 'object',
        properties: {
          clause: { type: 'string', enum: ['when', 'unless'] },
          index: { type: 'integer', minimum: 0 },
        },
        required: ['clause', 'index'],
        additionalProperties: false,
      },
      request: {
        title: 'RulesEvaluateRequest',
        description:
          "Input of rules_evaluate. The target is taken from the caller's registered connection, never from the request.",
        type: 'object',
        properties: { lageId: { $ref: 'common.schema.json#/$defs/cardId' } },
        required: ['lageId'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/rule.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/rule.schema.json',
    title: 'Rule',
    description:
      "A user-authored decision rule (ADR-0013). It is stored as the `rule` field of a card of type `rule`; the rule id is that card's id. `when` and `unless` are conditions over accepted cards on a Lage, card fields, edges or the user's own stances; `then` is the user's preferred action, shown verbatim, never combined into a recommendation.",
    type: 'object',
    properties: {
      when: {
        description: 'All conditions must hold for the rule to fire.',
        type: 'array',
        minItems: 1,
        items: { $ref: '#/$defs/condition' },
      },
      then: {
        description: 'The preferred action, as the user wrote it.',
        $ref: 'common.schema.json#/$defs/text',
      },
      unless: {
        description: 'If any of these conditions holds, the rule does not fire.',
        type: 'array',
        items: { $ref: '#/$defs/condition' },
      },
    },
    required: ['when', 'then'],
    additionalProperties: false,
    $defs: {
      condition: {
        title: 'RuleCondition',
        oneOf: [
          { $ref: '#/$defs/cardOnLage' },
          { $ref: '#/$defs/cardField' },
          { $ref: '#/$defs/tag' },
          { $ref: '#/$defs/edgeExists' },
          { $ref: '#/$defs/stance' },
        ],
      },
      cardOnLage: {
        title: 'CardOnLageCondition',
        description: 'The card is placed on the Lage and accepted.',
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'card_on_lage' },
          card: { $ref: 'common.schema.json#/$defs/cardId' },
        },
        required: ['kind', 'card'],
        additionalProperties: false,
      },
      cardField: {
        title: 'CardFieldCondition',
        description:
          'A canonical card field equals a value: on `card` if given, otherwise on any accepted card placed on the Lage.',
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'card_field' },
          card: { $ref: 'common.schema.json#/$defs/cardId' },
          field: {
            type: 'string',
            enum: [
              'type',
              'layer',
              'collection',
              'status',
              'class',
              'visibility',
              'release',
              'originSystem',
              'author',
            ],
          },
          equals: { $ref: 'common.schema.json#/$defs/text' },
        },
        required: ['kind', 'field', 'equals'],
        additionalProperties: false,
      },
      edgeExists: {
        title: 'EdgeCondition',
        description:
          'An accepted edge of this kind exists on the Lage, optionally restricted to its endpoints.',
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'edge' },
          edgeKind: { $ref: 'common.schema.json#/$defs/edgeKind' },
          from: { $ref: 'common.schema.json#/$defs/cardId' },
          to: { $ref: 'common.schema.json#/$defs/cardId' },
        },
        required: ['kind', 'edgeKind'],
        additionalProperties: false,
      },
      stance: {
        title: 'StanceCondition',
        description:
          "The user's own stance on a card. Rules with such a condition are withheld from every non-screen target (ADR-0013).",
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'stance' },
          card: { $ref: 'common.schema.json#/$defs/cardId' },
          position: { $ref: 'common.schema.json#/$defs/stancePosition' },
        },
        required: ['kind', 'card', 'position'],
        additionalProperties: false,
      },
      tag: {
        title: 'TagCondition',
        description:
          'A card has this tag: `card` if given, otherwise any accepted card placed on the Lage.',
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'tag' },
          card: { $ref: 'common.schema.json#/$defs/cardId' },
          tag: { $ref: 'common.schema.json#/$defs/text' },
        },
        required: ['kind', 'tag'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/source-profile.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/source-profile.schema.json',
    title: 'SourceProfile',
    description:
      "Multi-dimensional profile of a source (ADR-0018). Never one score: there is no aggregate field and no overall ranking. Every dimension carries its sample size `n`; below `minimumN` the UI shows 'insufficient data'. Derived from resolved estimates and decision outcomes, never edited by hand. agreement, deviation and counterPerspectiveValue use the user's stances and stay on the device.",
    type: 'object',
    properties: {
      source: {
        description: 'The profiled source: a card id or URI.',
        $ref: 'common.schema.json#/$defs/sourceRef',
      },
      computedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
      minimumN: {
        description: 'Sample size below which a value is shown as insufficient data.',
        type: 'integer',
        minimum: 1,
      },
      dimensions: {
        type: 'object',
        properties: {
          hitAccuracy: { $ref: '#/$defs/dimension' },
          reliability: { $ref: '#/$defs/dimension' },
          topicCompetence: { type: 'array', items: { $ref: '#/$defs/topicDimension' } },
          agreement: { $ref: '#/$defs/dimension' },
          deviation: { $ref: '#/$defs/dimension' },
          sourceQuality: { $ref: '#/$defs/dimension' },
          historicalPerformance: { $ref: '#/$defs/dimension' },
          counterPerspectiveValue: { $ref: '#/$defs/dimension' },
        },
        required: [
          'hitAccuracy',
          'reliability',
          'topicCompetence',
          'agreement',
          'deviation',
          'sourceQuality',
          'historicalPerformance',
          'counterPerspectiveValue',
        ],
        additionalProperties: false,
      },
    },
    required: ['source', 'computedAt', 'minimumN', 'dimensions'],
    additionalProperties: false,
    $defs: {
      dimension: {
        title: 'SourceProfileDimension',
        description:
          'One dimension: a value in [0, 1] and its sample size. A value is required once n >= 1.',
        type: 'object',
        properties: {
          value: { type: 'number', minimum: 0, maximum: 1 },
          n: { type: 'integer', minimum: 0 },
        },
        required: ['n'],
        additionalProperties: false,
        if: { properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'] },
        then: { properties: { value: true }, required: ['value'] },
        else: { not: { properties: { value: true }, required: ['value'] } },
      },
      topicDimension: {
        title: 'SourceProfileTopicDimension',
        type: 'object',
        properties: {
          topic: { $ref: 'common.schema.json#/$defs/text' },
          value: { type: 'number', minimum: 0, maximum: 1 },
          n: { type: 'integer', minimum: 0 },
        },
        required: ['topic', 'n'],
        additionalProperties: false,
        if: { properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'] },
        then: { properties: { value: true }, required: ['value'] },
        else: { not: { properties: { value: true }, required: ['value'] } },
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/stance.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/stance.schema.json',
    title: 'Stance',
    description:
      "The local user's private stance on one card (ADR-0008). Only a human sets it; it is stored on the device only, never in card files, and is disclosed to target screen only (ADR-0012). Every change keeps the previous version in `history`.",
    type: 'object',
    properties: {
      cardId: { $ref: 'common.schema.json#/$defs/cardId' },
      position: { $ref: 'common.schema.json#/$defs/stancePosition' },
      weight: { $ref: '#/$defs/weight' },
      note: { description: 'Free note, e.g. a mapped own assessment.', type: 'string' },
      updatedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
      history: {
        description: 'Previous versions, oldest first.',
        type: 'array',
        items: { $ref: '#/$defs/version' },
      },
    },
    required: ['cardId', 'position', 'weight', 'updatedAt', 'history'],
    additionalProperties: false,
    $defs: {
      weight: {
        title: 'StanceWeight',
        description:
          'Strength with which the position is held: 1 = weak, 2 = moderate, 3 = strong. Deliberately coarse; no percentages (ADR-0008).',
        type: 'integer',
        minimum: 1,
        maximum: 3,
      },
      version: {
        title: 'StanceVersion',
        type: 'object',
        properties: {
          position: { $ref: 'common.schema.json#/$defs/stancePosition' },
          weight: { $ref: '#/$defs/weight' },
          note: { type: 'string' },
          updatedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
        },
        required: ['position', 'weight', 'updatedAt'],
        additionalProperties: false,
      },
      input: {
        title: 'StanceInput',
        description:
          'Body of the human-only stance_save operation. The server sets cardId (from the path), updatedAt and history.',
        type: 'object',
        properties: {
          position: { $ref: 'common.schema.json#/$defs/stancePosition' },
          weight: { $ref: '#/$defs/weight' },
          note: { type: 'string' },
        },
        required: ['position', 'weight'],
        additionalProperties: false,
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/store-config.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/store-config.schema.json',
    title: 'StoreConfig',
    description:
      'Configuration persisted once per store. `storeInstanceId` is the random UUID used in card URIs (ADR-0023); it must never be a hostname, path or user name.',
    type: 'object',
    properties: {
      storeInstanceId: { $ref: 'common.schema.json#/$defs/uuid' },
      synthetic: {
        description: 'True if every card in this store is invented example data (ADR-0022).',
        type: 'boolean',
        default: false,
      },
    },
    required: ['storeInstanceId'],
    additionalProperties: false,
  },
  'https://worldbuilder.invalid/schemas/v0/training-export-record.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/training-export-record.schema.json',
    title: 'TrainingExportRecord',
    description:
      "One JSONL line of the training export: a decision trace (ADR-0017, ADR-0028). Exported only if the decision card has training: true. Used cards appear only with training: true; cards that did not opt in are omitted entirely, not even as ids: the decision's cardsUsed, the Lage placements and edges list only opted-in cards, and a brainstorm proposal touching any other card is dropped. The Lage is exported only if the Lage card itself opted in. Never contains stance data.",
    type: 'object',
    properties: {
      exportedAt: { $ref: 'common.schema.json#/$defs/dateTime' },
      decision: {
        allOf: [
          { $ref: 'decision.schema.json' },
          { $ref: '#/$defs/optedIn' },
          { $ref: '#/$defs/structuredOnly' },
        ],
      },
      usedCards: {
        type: 'array',
        items: { allOf: [{ $ref: 'card.schema.json' }, { $ref: '#/$defs/optedIn' }] },
      },
      lage: {
        description:
          'The Lage card, only if it has training: true, with placements and edges filtered to opted-in cards.',
        allOf: [
          { $ref: 'card.schema.json' },
          { $ref: '#/$defs/optedIn' },
          { $ref: '#/$defs/lageCard' },
          { $ref: '#/$defs/structuredOnly' },
        ],
      },
      brainstorm: {
        description: 'Accepted proposals that shaped the decision.',
        type: 'array',
        items: { allOf: [{ $ref: 'proposal.schema.json' }, { $ref: '#/$defs/accepted' }] },
      },
      outcome: { $ref: 'common.schema.json#/$defs/text' },
    },
    required: ['exportedAt', 'decision', 'usedCards', 'brainstorm', 'outcome'],
    additionalProperties: false,
    $defs: {
      optedIn: {
        title: 'TrainingOptIn',
        type: 'object',
        properties: { training: { type: 'boolean', const: true } },
        required: ['training'],
      },
      accepted: {
        title: 'AcceptedProposal',
        type: 'object',
        properties: { status: { type: 'string', const: 'accepted' } },
        required: ['status'],
      },
      lageCard: {
        title: 'TrainingLageCard',
        type: 'object',
        properties: { type: { type: 'string', const: 'lage' }, lage: true },
        required: ['type', 'lage'],
      },
      structuredOnly: {
        title: 'TrainingStructuredCard',
        description:
          'Decision and Lage cards are exported by their structured sections only: their Markdown body repeats card ids and is left out.',
        type: 'object',
        properties: { body: false },
      },
    },
  },
  'https://worldbuilder.invalid/schemas/v0/world.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://worldbuilder.invalid/schemas/v0/world.schema.json',
    title: 'World',
    description:
      'A modelled slice of reality from a perspective. Cards appear in worlds by reference (`Card.worlds`), never as copies. Private by default (ADR-0021).',
    type: 'object',
    properties: {
      id: { $ref: 'common.schema.json#/$defs/worldId' },
      name: {
        description:
          'Display name; stores that reference worlds by name resolve them through it (ADR-0023).',
        $ref: 'common.schema.json#/$defs/text',
      },
      description: { type: 'string' },
      visibility: { $ref: 'common.schema.json#/$defs/visibility', default: 'private' },
      release: { $ref: 'common.schema.json#/$defs/release', default: 'private' },
    },
    required: ['id', 'name'],
    additionalProperties: false,
  },
};
