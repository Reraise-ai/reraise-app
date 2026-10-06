// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// GENERATED FILE, DO NOT EDIT. Source: schemas/*.schema.json.
// Regenerate with `pnpm generate:types`; a test fails if this file is out of date.
// The types describe shapes only; validate data against the JSON Schemas for the rules.

export type EmptyRequest = Record<string, never>;
/**
 * Canonical world id (ULID).
 */
export type WorldId = Ulid;
/**
 * Non-empty text that is not only whitespace.
 */
export type Text = string;
export type Visibility =
  'private' | 'company_internal' | 'cross_partner' | 'customer_visible' | 'public';
/**
 * Release tier, recorded without behaviour (ADR-0021).
 */
export type Release = 'private' | 'community' | 'commercial';
/**
 * Canonical card id (ULID). Canonical objects always hold this id, never a store-local id.
 */
export type CardId = Ulid;
/**
 * Directed edge kinds of card format v2 (ADR-0023).
 */
export type EdgeKind =
  | 'supports'
  | 'refutes'
  | 'represents'
  | 'cites'
  | 'based_on'
  | 'depends_on'
  | 'relation'
  | 'unspecified';
/**
 * human or agent:<name>.
 */
export type KnownAuthor = string;
/**
 * Epistemic kind of a card (ADR-0007). believed is never a layer; it is a private stance (ADR-0008).
 */
export type Layer = 'evidenced' | 'said' | 'experience';
/**
 * Opaque pagination cursor.
 */
export type Cursor = string;
/**
 * Canonical card (ADR-0023). Every store maps to this model; card format v2 rules (layer, author, provenance, player fields, Lage, decision sections) apply to format-2 cards (ADR-0007, ADR-0009). Stance data is never part of a card (ADR-0008).
 */
export type Card = CardContent &
  Required<
    Pick<
      CardContent,
      'id' | 'externalId' | 'uri' | 'format' | 'type' | 'title' | 'author' | 'contentHash'
    >
  >;
/**
 * Reference to a card in its home store: wb:<storeInstanceId>/<externalId>, in canonical form only: the external id NFC-normalised, UTF-8, every unreserved character literal and every other byte %XX with upper-case hex (RFC 3986). A URI that differs from buildUri(storeInstanceId, externalId) is not a card URI (for example %2D for '-'). storeInstanceId is a random UUID, never a hostname, path or user name (ADR-0005, ADR-0023).
 */
export type WbUri = string;
/**
 * Store collection a card lives in (ADR-0023).
 */
export type Collection = 'actors' | 'evidence' | 'decisions';
export type IsoDate = string;
/**
 * sha256:<lower-case hex> over the RFC 8785 (JCS) serialisation of the hashed card content (ADR-0034).
 */
export type ContentHash = string;
export type CardStatus = 'draft' | 'checked' | 'released';
/**
 * Sensitivity class; input to disclosure-gate rules (ADR-0023).
 */
export type CardClass = 'A' | 'B' | 'C';
/**
 * human, agent:<name>, or unknown. unknown is valid only on legacy format-1 cards and on edges read from legacy links (ADR-0009, ADR-0023).
 */
export type Author = string;
/**
 * A card id or an absolute URI (for example a wb: URI or a web address). Used where provenance must be machine-resolvable, e.g. player fields (ADR-0009).
 */
export type SourceRef = Ulid;
/**
 * A ULID: 26 Crockford base32 characters, upper case. Canonical ids are minted ULIDs or derived from the card URI (first 128 bits of SHA-256(uri), ADR-0023).
 */
export type Ulid = string;
/**
 * Player-field entries; each needs a source (ADR-0009).
 */
export type PlayerField = PlayerEntry[];
export type RuleCondition =
  CardOnLageCondition | CardFieldCondition | EdgeCondition | StanceCondition;
export type StancePosition = 'believed' | 'rejected' | 'undecided';
/**
 * An agent move (ADR-0011). `proposal_create` is the only write path for agents; the server sets `id`, `author` (from the connection's agent identity), `status` and `createdAt`. Accept and reject are human-only. Pending or rejected proposals never count anywhere.
 */
export type Proposal = ProposalKindPayload & {
  id: Ulid;
  author: AgentAuthor;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  /**
   * Why the agent proposes this.
   */
  rationale?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: DateTime;
  decidedBy?: HumanAuthor;
  decidedAt?: DateTime;
};
/**
 * The payload shape is fixed by `kind`.
 */
export type ProposalKindPayload =
  | {
      kind: 'place_card';
      payload: PlaceCardPayload;
    }
  | {
      kind: 'move_card';
      payload: MoveCardPayload;
    }
  | {
      kind: 'add_edge';
      payload: AddEdgePayload;
    }
  | {
      kind: 'create_card';
      payload: CreateCardPayload;
    }
  | {
      kind: 'comment';
      payload: CommentPayload;
    };
/**
 * A card proposed for creation (proposal kind create_card). Identity is assigned by the store on accept; the author is set by the server from the agent connection, never taken from the payload (ADR-0011).
 */
export type CardDraft = CardContent &
  Required<Pick<CardContent, 'type' | 'title'>> & {
    format: 2;
    id?: never;
    externalId?: never;
    uri?: never;
    author?: never;
  };
/**
 * An agent identity: agent:<name>.
 */
export type AgentAuthor = string;
export type ProposalKind = 'place_card' | 'move_card' | 'add_edge' | 'create_card' | 'comment';
export type DateTime = string;
/**
 * The local human user. Human-only operations record this value.
 */
export type HumanAuthor = 'human';
/**
 * A lower-case RFC 9562 UUID.
 */
export type Uuid = string;
/**
 * Where content may go (ADR-0012).
 */
export type DisclosureTarget = 'screen' | 'local_model' | 'cloud_model' | 'demo';
/**
 * ICD 203 band keys (ADR-0010).
 */
export type ProbabilityBand =
  | 'almost_no_chance'
  | 'very_unlikely'
  | 'unlikely'
  | 'roughly_even'
  | 'likely'
  | 'very_likely'
  | 'almost_certain';
/**
 * Lower-case hex SHA-256 digest.
 */
export type Sha256 = string;
/**
 * Strength with which the position is held: 1 = weak, 2 = moderate, 3 = strong. Deliberately coarse; no percentages (ADR-0008).
 */
export type StanceWeight = number;
/**
 * sha256:<lower-case hex> over the RFC 8785 (JCS) serialisation of the preview envelope (ADR-0031, ADR-0034).
 */
export type PayloadHash = string;
/**
 * Opaque single-use token, base64url of at least 16 random bytes (128 bits).
 */
export type ConfirmationToken = string;
/**
 * A decision card: a format-2 card of type decision with exactly eleven non-empty sections (ADR-0017). Saving one is a human-only operation (ADR-0016).
 */
export type Decision = Card & {
  type?: 'decision';
  format?: 2;
  sections: DecisionSections;
};
/**
 * Body of the human-only decision create operation: a decision card without identity or author (the store assigns the id; the author is the human).
 */
export type DecisionDraft = CardDraft & {
  type: 'decision';
  sections: DecisionSections;
};
/**
 * A new finding reported by a SourceConnector (ADR-0014). It is a reference with provenance, not content we ingest; nothing in the inbox is part of a world until a human pins it (reference-then-pin).
 */
export type Finding = Finding1 & Finding2;
export type Finding1 =
  | {
      source: unknown;
    }
  | {
      originSystem: unknown;
    };
/**
 * Input of proposal_create. Contains no author, id or status; the server sets them.
 */
export type ProposalCreate = ProposalKindPayload & {
  kind: ProposalKind;
  payload: Record<string, unknown>;
  rationale?: string;
};

export interface WorldList {
  worlds: World[];
}
/**
 * A modelled slice of reality from a perspective. Cards appear in worlds by reference (`Card.worlds`), never as copies. Private by default (ADR-0021).
 */
export interface World {
  id: WorldId;
  name: Text;
  description?: string;
  visibility?: Visibility;
  release?: Release;
}
export interface LageGetRequest {
  lageId: CardId;
}
/**
 * Body of the human-only lage_create operation: a new Lage card. The store assigns the id; the author is the human.
 */
export interface LageCreateRequest {
  title: Text;
  worlds?: WorldId[];
  lage: Lage;
}
/**
 * Board state of a Lage (a card of type `lage`). Stored as a JSON block in the card body; a rewrite archives the previous version (ADR-0006, ADR-0023). Only the Lage format is persisted, never canvas-library state (ADR-0019).
 */
export interface Lage {
  question: Text;
  /**
   * The options under consideration.
   */
  options: Text[];
  /**
   * Cards placed on the board with their positions.
   */
  cards: LagePlacement[];
  /**
   * Players at the table: humans and agents.
   */
  seats: LageSeat[];
  /**
   * Edges drawn on this board.
   */
  edges: LageEdge[];
  /**
   * Version number of this state; increases on every rewrite. Used for optimistic concurrency.
   */
  version: number;
  /**
   * Time (or date, as some stores record it) of the last change.
   */
  updatedAt: string;
}
export interface LagePlacement {
  id: CardId;
  x: number;
  y: number;
}
export interface LageSeat {
  name: Text;
  kind: 'human' | 'agent';
}
export interface LageEdge {
  from: CardId;
  to: CardId;
  kind: EdgeKind;
  by: KnownAuthor;
}
export interface CardGetRequest {
  cardId: CardId;
}
export interface CardsSearchRequest {
  worldId?: WorldId;
  text?: string;
  type?: string;
  layer?: Layer;
  limit?: number;
  cursor?: Cursor;
}
/**
 * Gate-cleared cards for the caller's target; denied cards are omitted.
 */
export interface CardPage {
  cards: Card[];
  nextCursor?: Cursor;
  /**
   * Cards the gate withheld for the caller's target, by id and reason (ADR-0031).
   */
  denied?: DeniedCard[];
}
/**
 * All card fields with the format v2 rules. Shared by Card (identity required) and CardDraft (identity forbidden).
 */
export interface CardContent {
  id?: CardId;
  /**
   * The card's id in its home store (store-local).
   */
  externalId?: string;
  uri?: WbUri;
  /**
   * 1 = legacy card, 2 = card format v2. Cards written by the product are always format 2.
   */
  format?: 1 | 2;
  collection?: Collection;
  type?: Text;
  /**
   * The store's original type value, kept so that a patch never rewrites it.
   */
  typeRaw?: string;
  title?: Text;
  /**
   * Markdown body.
   */
  body?: string;
  date?: IsoDate;
  source?: Text;
  sourceDate?: IsoDate;
  /**
   * SHA-256 of the original source document (not `contentHash`). Must be SHA-256 on collection evidence.
   */
  sourceChecksum?: string;
  contentHash?: ContentHash;
  status?: CardStatus;
  /**
   * Carried as stored, without product semantics yet.
   */
  rating?: string | number;
  release?: Release;
  /**
   * Carried as stored.
   */
  carrier?: string;
  /**
   * Carried as stored.
   */
  affiliation?: string;
  visibility?: Visibility;
  class?: CardClass;
  layer?: Layer;
  /**
   * Worlds this card appears in, by reference; cards are never copied between worlds.
   */
  worlds?: WorldId[];
  /**
   * Free tags; disclosure-gate rules may match them (ADR-0031).
   */
  tags?: Text[];
  author?: Author;
  originSystem?: Text;
  /**
   * Opt-in for training export (ADR-0017).
   */
  training?: boolean;
  edges?: Edge[];
  interests?: PlayerField;
  capabilities?: PlayerField;
  dependencies?: PlayerField;
  moves?: PlayerField;
  lage?: Lage;
  sections?: DecisionSections;
  rule?: Rule;
  /**
   * Reserved for card tiers (ADR-0007, ADR-0021). Must not be used until an ADR defines it.
   */
  level?: never;
  /**
   * Reserved for an author key-pair signature (ADR-0021). Must not be used until an ADR defines it.
   */
  signature?: never;
}
/**
 * A directed, typed edge from the card that holds it to `target` (ADR-0023). `by` records who drew it (ADR-0009); `unknown` only for edges read from legacy links.
 */
export interface Edge {
  target: CardId;
  kind: EdgeKind;
  by: Author;
}
export interface PlayerEntry {
  text: Text;
  source: SourceRef;
}
/**
 * Exactly eleven sections, none empty (ADR-0017). `cardsUsed` ids must exist; `outcome` is `open` until known.
 */
export interface DecisionSections {
  situation: Text;
  trigger: Text;
  conditions: Text;
  facts: Text;
  priorities: Text;
  action: Text;
  alternatives: Text;
  exclusions: Text;
  rationale: Text;
  /**
   * @minItems 1
   */
  cardsUsed: CardId[];
  outcome: Text;
}
/**
 * A user-authored decision rule (ADR-0013). It is stored as the `rule` field of a card of type `rule`; the rule id is that card's id. `when` and `unless` are conditions over accepted cards on a Lage, card fields, edges or the user's own stances; `then` is the user's preferred action, shown verbatim, never combined into a recommendation.
 */
export interface Rule {
  /**
   * All conditions must hold for the rule to fire.
   *
   * @minItems 1
   */
  when: RuleCondition[];
  then: Text;
  /**
   * If any of these conditions holds, the rule does not fire.
   */
  unless?: RuleCondition[];
}
/**
 * The card is placed on the Lage and accepted.
 */
export interface CardOnLageCondition {
  kind: 'card_on_lage';
  card: CardId;
}
/**
 * A canonical card field equals a value: on `card` if given, otherwise on any accepted card placed on the Lage.
 */
export interface CardFieldCondition {
  kind: 'card_field';
  card?: CardId;
  field:
    | 'type'
    | 'layer'
    | 'collection'
    | 'status'
    | 'class'
    | 'visibility'
    | 'release'
    | 'originSystem'
    | 'author';
  equals: Text;
}
/**
 * An accepted edge of this kind exists on the Lage, optionally restricted to its endpoints.
 */
export interface EdgeCondition {
  kind: 'edge';
  edgeKind: EdgeKind;
  from?: CardId;
  to?: CardId;
}
/**
 * The user's own stance on a card. Rules with such a condition are withheld from every non-screen target (ADR-0013).
 */
export interface StanceCondition {
  kind: 'stance';
  card: CardId;
  position: StancePosition;
}
/**
 * A card the gate withheld from this response, with the reason; never its content.
 */
export interface DeniedCard {
  cardId: CardId;
  reason: Text;
}
export interface ProposalListRequest {
  status?: 'pending' | 'accepted' | 'rejected';
  lageId?: CardId;
  limit?: number;
  cursor?: Cursor;
  changedSince?: Cursor;
}
export interface ProposalPage {
  proposals: Proposal[];
  nextCursor?: Cursor;
}
/**
 * Place an existing card on a Lage.
 */
export interface PlaceCardPayload {
  lageId: CardId;
  cardId: CardId;
  x: number;
  y: number;
}
/**
 * Move a card that is already on a Lage.
 */
export interface MoveCardPayload {
  lageId: CardId;
  cardId: CardId;
  x: number;
  y: number;
}
/**
 * Draw an edge: on a Lage if `lageId` is given, otherwise as a card edge on `from`. `by` becomes the proposal author on accept.
 */
export interface AddEdgePayload {
  lageId?: CardId;
  from: CardId;
  to: CardId;
  kind: EdgeKind;
}
/**
 * Create a new card (for example a reference card for a finding, ADR-0014), optionally placed on a Lage.
 */
export interface CreateCardPayload {
  card: CardDraft;
  lageId?: CardId;
  x?: number;
  y?: number;
}
export interface CommentPayload {
  text: Text;
  cardId?: CardId;
  lageId?: CardId;
}
/**
 * Error response (RFC 9457). Never contains card content (ADR-0026).
 */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
}
/**
 * What a model or agent receives about the active world (ADR-0016, ADR-0024 item 34). Built after the disclosure gate: every item is gate-cleared for `target`; denied cards are omitted and only counted in `withheld`. Layers are never merged into a score. Only accepted content appears as items; pending proposals are listed separately. Stance data appears only for target screen; a cloud_model package carries content only with a confirmed, consumed transfer token.
 */
export interface ContextPackage {
  id: Ulid;
  target: DisclosureTarget;
  worldId: WorldId;
  lageId?: CardId;
  question?: Text;
  createdAt: DateTime;
  items: ContextItem[];
  independence: ContextIndependence;
  /**
   * Proposals that have not been accepted. Never facts; listed only in this section (ADR-0011).
   */
  pendingProposals: ContextPendingProposal[];
  /**
   * Number of cards the gate denied for this target.
   */
  withheld: number;
  transfer?: ContextTransferRef;
  /**
   * Cards the gate withheld, by id and reason. A cloud_model package without a confirmed transfer contains only these (ADR-0031).
   */
  denied?: DeniedCard[];
}
/**
 * One card for the target, with its provenance and gate decision. Layer and author are those of the card; a card without a layer is unclassified (ADR-0007).
 */
export interface ContextItem {
  card: Card;
  provenance: ContextProvenance;
  gate: ContextGate;
  stance?: Stance;
}
/**
 * Where the card comes from and which independent origin it belongs to (ADR-0009).
 */
export interface ContextProvenance {
  uri: WbUri;
  source?: Text;
  sourceDate?: IsoDate;
  originSystem?: Text;
  originRoot: Text;
  /**
   * False if the origin could not be traced; such a card counts as its own root and is flagged.
   */
  originKnown: boolean;
}
/**
 * The gate decision for this item and target. Items are always allowed; denied cards never appear.
 */
export interface ContextGate {
  decision: 'allow';
  reason: Text;
}
/**
 * The local user's private stance on one card (ADR-0008). Only a human sets it; it is stored on the device only, never in card files, and is disclosed to target screen only (ADR-0012). Every change keeps the previous version in `history`.
 */
export interface Stance {
  cardId: CardId;
  position: StancePosition;
  weight: StanceWeight;
  /**
   * Free note, e.g. a mapped own assessment.
   */
  note?: string;
  updatedAt: DateTime;
  /**
   * Previous versions, oldest first.
   */
  history: StanceVersion[];
}
export interface StanceVersion {
  position: StancePosition;
  weight: StanceWeight;
  note?: string;
  updatedAt: DateTime;
}
/**
 * 'N findings · M origins' over the items; never a bare card count.
 */
export interface ContextIndependence {
  findings: number;
  origins: number;
}
/**
 * A pending proposal, by id and kind only: no free text from agents reaches a model as context.
 */
export interface ContextPendingProposal {
  proposalId: Ulid;
  kind: ProposalKind;
}
/**
 * The confirmed cloud_model transfer this package belongs to.
 */
export interface ContextTransferRef {
  transferId: Ulid;
  confirmedAt: DateTime;
  payloadHash: PayloadHash;
}
/**
 * Input of context_package_get. The target is taken from the caller's registered connection, never from the request (ADR-0012). A cloud_model send carries the confirmation token of the transfer that previewed exactly this package (ADR-0031).
 */
export interface ContextPackageRequest {
  worldId: WorldId;
  lageId?: CardId;
  question?: Text;
  maxItems?: number;
  transferId?: Ulid;
  confirmationToken?: ConfirmationToken;
}
/**
 * Result of DisclosureGate.decide(card, target) (ADR-0012). Default deny: without a matching allow rule the decision is deny. An allow for cloud_model is only valid with the user's per-transfer confirmation. Stance data is allowed for target screen only. Decisions are logged without card content.
 */
export interface DisclosureDecision {
  subject: DisclosureSubject;
  target: DisclosureTarget;
  decision: 'allow' | 'deny';
  reason: Text;
  /**
   * The allow rule that matched, if any.
   */
  ruleId?: string;
  /**
   * True when the decision is deny only because the per-transfer confirmation is missing.
   */
  confirmationRequired?: boolean;
  confirmation?: DisclosureConfirmationRef;
  decidedAt: DateTime;
}
/**
 * What is being disclosed: a card, or the user's stance data on a card.
 */
export interface DisclosureSubject {
  kind: 'card' | 'stance';
  cardId: CardId;
}
/**
 * Reference to a confirmed transfer whose token was consumed for this send; recorded in gate decisions and context packages. Contains no token.
 */
export interface DisclosureConfirmationRef {
  transferId: Ulid;
  payloadHash: PayloadHash;
  /**
   * @minItems 1
   */
  cardIds: CardId[];
  confirmedAt: DateTime;
}
/**
 * A previewed cloud_model transfer awaiting the user's confirmation (ADR-0012, ADR-0031). The record lives in memory on the service, expires 5 minutes after the preview, and is void after a restart. `cardIds` lists the ids of the objects in the envelope; `payloadHash` must be echoed by the confirmation.
 */
export interface DisclosureTransfer {
  transferId: Ulid;
  purpose: 'context_package' | 'level1' | 'export';
  /**
   * @minItems 1
   */
  cardIds: CardId[];
  payloadHash: PayloadHash;
  preview: DisclosurePreviewEnvelope;
  createdAt: DateTime;
  expiresAt: DateTime;
}
/**
 * Exactly what would leave the device: the target, the connector, the request parameters and the canonical objects after the gate decision. The payload hash covers this envelope.
 */
export interface DisclosurePreviewEnvelope {
  target: 'cloud_model';
  connectorId: string;
  request: DisclosureModelRequest;
  /**
   * @minItems 1
   */
  objects: Card[];
}
/**
 * The request parameters that go to the model with the objects.
 */
export interface DisclosureModelRequest {
  question?: Text;
  options?: Text[];
  /**
   * JSON Schema the answer must follow (level 1).
   */
  outputSchema?: Record<string, unknown>;
}
/**
 * Body of the human-only confirm operation (the transferId is in the path). The service rejects a payloadHash that differs from the stored one or from the hash of the current envelope, and a second confirmation (409), and an expired transfer (410).
 */
export interface DisclosureConfirmRequest {
  payloadHash: PayloadHash;
}
/**
 * Response of the human-only confirm operation (ADR-0031): a single-use confirmation token, at least 128 random bits, held server side, bound to the confirming human session, valid for 5 minutes and void after a restart. The send call carries it; the service consumes it atomically before sending an envelope whose hash equals `payloadHash`. Never logged.
 */
export interface DisclosureConfirmation {
  transferId: Ulid;
  payloadHash: PayloadHash;
  /**
   * @minItems 1
   */
  cardIds: CardId[];
  token: ConfirmationToken;
  tokenExpiresAt: DateTime;
  confirmedBy: HumanAuthor;
  confirmedAt: DateTime;
}
/**
 * Body of the human-only preview operation: what the user wants to send. The server builds the envelope from gate-cleared canonical objects only.
 */
export interface DisclosurePreviewRequest {
  connectorId: string;
  purpose: 'context_package' | 'level1' | 'export';
  request: DisclosureModelRequest;
  /**
   * @minItems 1
   */
  cardIds: CardId[];
}
export interface Finding2 {
  /**
   * Where the finding lives in its home system.
   */
  uri: string;
  /**
   * Id of the reporting SourceConnector.
   */
  connector: string;
  title: Text;
  /**
   * Minimal display text; never the full third-party content.
   */
  snippet?: string;
  source?: Text;
  sourceDate?: IsoDate;
  originSystem?: Text;
  retrievedAt: DateTime;
}
/**
 * Disclosure-gate configuration (ADR-0012, ADR-0031): the user's rule file (`<state>/gate-rules.yaml`), with allow and deny rules per target. A card is allowed for a target only if at least one allow rule matches it and no deny rule does: deny wins, and without a matching allow rule the decision is deny. Rules match card fields only; nothing matches stance data, which stays on the screen whatever the rules say (ADR-0008).
 */
export interface GateRules {
  rules: GateRule[];
}
export interface GateRule {
  id: string;
  effect: 'allow' | 'deny';
  /**
   * @minItems 1
   */
  targets: DisclosureTarget[];
  match: GateMatch;
  description?: string;
}
/**
 * All given criteria must hold (AND); within one criterion any listed value matches (OR). An empty match matches every card.
 */
export interface GateMatch {
  /**
   * @minItems 1
   */
  visibility?: Visibility[];
  /**
   * @minItems 1
   */
  class?: CardClass[];
  /**
   * @minItems 1
   */
  collection?: Collection[];
  /**
   * Matches if the card appears in any of these worlds, given by name or id.
   *
   * @minItems 1
   */
  worlds?: Text[];
  /**
   * @minItems 1
   */
  type?: Text[];
  /**
   * Matches if the card has any of these tags.
   *
   * @minItems 1
   */
  tags?: Text[];
  /**
   * @minItems 1
   */
  ids?: CardId[];
  /**
   * Matches cards of a store whose configuration says synthetic: true (demo clearance, ADR-0028).
   */
  syntheticStore?: true;
}
/**
 * Rules supplied by an adapter for its sensitive classes (ADR-0031). Deny rules only: a fragment with an allow rule is rejected at load time, so an adapter can only narrow what leaves the device.
 */
export interface GateRuleFragment {
  /**
   * The adapter that supplies the fragment.
   */
  source: string;
  rules: (GateRule & {
    effect?: 'deny';
  })[];
}
/**
 * A fast, typed level-1 answer (ADR-0015). It is an attributed engine estimate ('<engine> estimates 0.82 for X'), never a verdict: it does not count as a decision, does not trigger rules and does not enter statistics. `choice` is one of `options`. World changes it implies arrive as proposals by agent:<engine>.
 */
export interface Level1Answer {
  id?: Ulid;
  /**
   * Engine name, e.g. local-rules, a local model, or the Jev connector.
   */
  engine: string;
  question: Text;
  /**
   * The closed set of options (the enum of the output schema).
   *
   * @minItems 2
   */
  options: Text[];
  choice: Text;
  /**
   * The engine's own confidence for `choice`, shown attributed to the engine. Not an ICD 203 estimate.
   */
  confidence: number;
  /**
   * Cards and rules the engine received (after the disclosure gate).
   */
  inputs: Level1Input[];
  answeredAt: DateTime;
}
export interface Level1Input {
  kind: 'card' | 'rule';
  id: CardId;
}
/**
 * What a ModelConnector receives for a level-1 decision: the question, the closed options, and gate-cleared inputs.
 */
export interface Level1Request {
  question: Text;
  /**
   * @minItems 2
   */
  options: Text[];
  inputs: Level1Input[];
}
/**
 * An estimative statement found on a card (ADR-0010). Stores the source's original `phrase` verbatim and the mapped ICD 203 `band` (almost_no_chance 1-5 %, very_unlikely 5-20 %, unlikely 20-45 %, roughly_even 45-55 %, likely 55-80 %, very_likely 80-95 %, almost_certain 95-99 %). A number is stored only if the source stated one. The UI shows words. Mappings are made by a human or a deterministic lookup table; an agent's mapping is a proposal.
 */
export interface Prediction {
  id: Ulid;
  cardId: CardId;
  statement: Text;
  phrase: Text;
  /**
   * BCP 47 language tag of the phrase.
   */
  language?: string;
  band?: ProbabilityBand;
  /**
   * human, or lookup:<table> for a deterministic lookup table. Never an agent.
   */
  mappedBy?: string;
  /**
   * Only if the source itself stated a number, as a fraction.
   */
  statedProbability?: number;
  resolveBy?: IsoDate;
  resolution?: PredictionResolution;
}
/**
 * Recorded through the outcome loop by a human (ADR-0017).
 */
export interface PredictionResolution {
  outcome: 'occurred' | 'did_not_occur' | 'undeterminable';
  resolvedAt: DateTime;
  decisionId?: CardId;
  resolvedBy: HumanAuthor;
}
/**
 * Body of the human-only accept or reject operation.
 */
export interface ProposalDecide {
  note?: string;
}
/**
 * Result of rules_evaluate for one Lage and one disclosure target (ADR-0013). Lists which rules fire and why. There is deliberately no percentage, score, ratio, aggregate, net value or recommended option, and no field may be added for one. Only accepted cards trigger rules. For non-screen targets, rules with a stance-dependent condition or a condition on a card not cleared for the target are omitted and only counted in `withheld`.
 */
export interface RuleEvaluation {
  lageId: CardId;
  lageVersion: number;
  target: DisclosureTarget;
  evaluatedAt: DateTime;
  results: RuleResult[];
  /**
   * Number of rules omitted for this target. Always 0 for target screen.
   */
  withheld: number;
}
export interface RuleResult {
  ruleId: CardId;
  fired: boolean;
  /**
   * Accepted cards that satisfied the conditions, filtered by the gate for the target.
   */
  triggeringCardIds: CardId[];
  /**
   * Conditions that were evaluated and did not hold.
   */
  unmet: RuleConditionRef[];
  /**
   * Conditions that could not be evaluated (for example a referenced card is missing).
   */
  unknown: RuleConditionRef[];
  rule?: Rule;
}
/**
 * Points at one condition of the rule by clause and position.
 */
export interface RuleConditionRef {
  clause: 'when' | 'unless';
  index: number;
}
/**
 * Input of rules_evaluate. The target is taken from the caller's registered connection, never from the request.
 */
export interface RulesEvaluateRequest {
  lageId: CardId;
}
/**
 * Multi-dimensional profile of a source (ADR-0018). Never one score: there is no aggregate field and no overall ranking. Every dimension carries its sample size `n`; below `minimumN` the UI shows 'insufficient data'. Derived from resolved estimates and decision outcomes, never edited by hand. agreement, deviation and counterPerspectiveValue use the user's stances and stay on the device.
 */
export interface SourceProfile {
  source: SourceRef;
  computedAt: DateTime;
  /**
   * Sample size below which a value is shown as insufficient data.
   */
  minimumN: number;
  dimensions: {
    hitAccuracy: SourceProfileDimension;
    reliability: SourceProfileDimension;
    topicCompetence: SourceProfileTopicDimension[];
    agreement: SourceProfileDimension;
    deviation: SourceProfileDimension;
    sourceQuality: SourceProfileDimension;
    historicalPerformance: SourceProfileDimension;
    counterPerspectiveValue: SourceProfileDimension;
  };
}
/**
 * One dimension: a value in [0, 1] and its sample size. A value is required once n >= 1.
 */
export interface SourceProfileDimension {
  value?: number;
  n: number;
}
export interface SourceProfileTopicDimension {
  topic: Text;
  value?: number;
  n: number;
}
/**
 * Configuration persisted once per store. `storeInstanceId` is the random UUID used in card URIs (ADR-0023); it must never be a hostname, path or user name.
 */
export interface StoreConfig {
  storeInstanceId: Uuid;
  /**
   * True if every card in this store is invented example data (ADR-0022).
   */
  synthetic?: boolean;
}
/**
 * One JSONL line of the training export: a decision trace (ADR-0017, ADR-0028). Exported only if the decision card has training: true. Used cards appear only with training: true; cards that did not opt in are omitted entirely, not even as ids: the decision's cardsUsed, the Lage placements and edges list only opted-in cards, and a brainstorm proposal touching any other card is dropped. The Lage is exported only if the Lage card itself opted in. Never contains stance data.
 */
export interface TrainingExportRecord {
  exportedAt: DateTime;
  decision: Decision & TrainingOptIn & TrainingStructuredCard;
  usedCards: (Card & TrainingOptIn)[];
  /**
   * The Lage card, only if it has training: true, with placements and edges filtered to opted-in cards.
   */
  lage?: Card & TrainingOptIn & TrainingLageCard & TrainingStructuredCard;
  /**
   * Accepted proposals that shaped the decision.
   */
  brainstorm: (Proposal & AcceptedProposal)[];
  outcome: Text;
}
export interface TrainingOptIn {
  training: true;
}
/**
 * Decision and Lage cards are exported by their structured sections only: their Markdown body repeats card ids and is left out.
 */
export interface TrainingStructuredCard {
  body?: never;
}
export interface TrainingLageCard {
  type: 'lage';
  lage: unknown;
}
export interface AcceptedProposal {
  status: 'accepted';
}
