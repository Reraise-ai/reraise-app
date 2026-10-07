// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// One handler per operationId of schemas/openapi/board-api.yaml. A handler gets the validated
// input and the caller's principal and returns a status and a body; authentication, request and
// response validation and error mapping live in app.ts. The MCP front end of the next slice
// calls the same handlers (ADR-0029: both front ends end in the same code).

import type {
  Card,
  CardDraft,
  CardPatch,
  ContextPackageRequest,
  DecisionDraft,
  DisclosureConfirmRequest,
  DisclosurePreviewRequest,
  Lage,
  LageCreateRequest,
  ProposalCreate,
  StanceInput,
} from '@worldbuilder/core';
import { targetOf, type Principal } from './auth.js';
import { buildContextPackage } from './context.js';
import { readLage } from './lage.js';
import { HttpError } from './problem.js';
import { applyProposal, forbiddenDraftFields } from './proposals.js';
import { evaluateRules } from './rules.js';
import { stanceFor, type Services } from './services.js';
import { validators } from './contract.js';

export interface OperationInput {
  readonly principal: Principal;
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

export interface OperationResult {
  readonly status: number;
  readonly body: unknown;
}

export type Handler = (s: Services, input: OperationInput) => Promise<OperationResult>;

const ok = (body: unknown, status = 200): OperationResult => ({ status, body });
const str = (v: unknown): string => v as string;

const DEFAULT_SEARCH_LIMIT = 50;
/** Pages looked at for one filtered search of a model target before it answers (maybe empty). */
const MAX_SEARCH_PAGES = 50;

const fold = (t: string): string => t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** The text, type and layer filters of cards_search as a test over one (already cleared) card. */
function matcherOf(query: Readonly<Record<string, unknown>>): (card: Card) => boolean {
  const tokens = fold(query['text'] ? str(query['text']) : '')
    .split(/\s+/)
    .filter((t) => t !== '');
  return (card) => {
    if (query['type'] && card.type !== query['type']) return false;
    if (query['layer'] && card.layer !== query['layer']) return false;
    if (tokens.length === 0) return true;
    const haystack = fold(`${card.title}\n${card.body ?? ''}\n${(card.tags ?? []).join(' ')}`);
    return tokens.every((t) => haystack.includes(t));
  };
}

const checkDraft = validators.strict('card.schema.json#/$defs/draft');

function assertDraft(draft: unknown): asserts draft is CardDraft {
  const result = checkDraft(draft);
  if (!result.ok) throw new HttpError(400, `invalid card: ${result.message}`);
}

async function requireCards(s: Services, ids: readonly string[], what: string): Promise<Card[]> {
  const cards: Card[] = [];
  for (const id of ids) {
    const card = await s.storage.read(id);
    if (!card) throw new HttpError(400, `${what}: unknown card ${id}`);
    cards.push(card);
  }
  return cards;
}

/** The card as the caller may see it: the gate decides for the caller's target. */
async function visibleCard(s: Services, p: Principal, id: string): Promise<Card | undefined> {
  const card = await s.storage.read(id);
  if (!card) return undefined;
  return (await s.gate.decide(card, targetOf(p))).decision === 'allow' ? card : undefined;
}

const NOT_PATCHABLE = new Set([
  'id',
  'externalId',
  'uri',
  'format',
  'author',
  'contentHash',
  'level',
  'signature',
]);

const notImplemented =
  (what: string): Handler =>
  async () => {
    throw new HttpError(501, `${what} is not implemented in this build`);
  };

export const handlers: Readonly<Record<string, Handler>> = {
  knowledge_consult: notImplemented('knowledge_consult'),
  knowledge_write_back: notImplemented('knowledge_write_back'),
  decision_record: notImplemented('decision_record'),
  decision_outcome: notImplemented('decision_outcome'),
  memory_route: notImplemented('memory_route'),
  usage_metrics_get: notImplemented('usage_metrics_get'),

  async world_list(s, { principal }) {
    const worlds = await s.storage.listWorlds();
    // A world has no gate decision of its own yet: a cloud_model connection sees public worlds.
    return ok({
      worlds:
        principal.kind === 'agent' && principal.target === 'cloud_model'
          ? worlds.filter((w) => w.visibility === 'public')
          : [...worlds],
    });
  },

  async lage_create(s, { body }) {
    const req = body as LageCreateRequest;
    if (req.lage.version !== 1) throw new HttpError(400, 'a new Lage starts at version 1');
    const draft = {
      format: 2,
      type: 'lage',
      title: req.title,
      ...(req.worlds ? { worlds: req.worlds } : {}),
      lage: req.lage,
    };
    assertDraft(draft);
    const id = await s.writes.run(() => s.storage.create(draft, 'human'));
    return ok(await s.storage.read(id), 201);
  },

  async lage_get(s, { principal, params }) {
    const lage = await readLage(s, str(params['lageId']));
    const visible = lage ? await visibleCard(s, principal, lage.id) : undefined;
    if (!visible) throw new HttpError(404, 'unknown Lage');
    return ok(visible);
  },

  async lage_save(s, { params, body }) {
    const lageId = str(params['lageId']);
    const next = body as Lage;
    await s.writes.run(async () => {
      const stored = await readLage(s, lageId);
      if (!stored) throw new HttpError(404, 'unknown Lage');
      if (next.version !== stored.lage.version + 1) {
        throw new HttpError(
          409,
          `version conflict: the stored version is ${stored.lage.version}, expected ${stored.lage.version + 1}`,
        );
      }
      await s.storage.patch(lageId, { lage: next }, { lageVersion: stored.lage.version });
    });
    return ok(await s.storage.read(lageId));
  },

  async cards_search(s, { principal, query }) {
    const target = targetOf(principal);
    const limit = (query['limit'] as number | undefined) ?? DEFAULT_SEARCH_LIMIT;
    if (target === 'screen') {
      const page = await s.storage.search({
        ...(query['worldId'] ? { worldId: str(query['worldId']) } : {}),
        ...(query['text'] ? { text: str(query['text']) } : {}),
        ...(query['type'] ? { type: str(query['type']) } : {}),
        ...(query['layer'] ? { layer: query['layer'] as Card['layer'] & string } : {}),
        limit,
        ...(query['cursor'] ? { cursor: str(query['cursor']) } : {}),
      });
      const { allowed, denied } = await s.gate.filter(page.items, target);
      return ok({
        cards: allowed,
        ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
        ...(denied.length > 0 ? { denied } : {}),
      });
    }
    // A model target: the gate comes first and the filters run over the cleared cards only.
    // Searching the store first would let a match (or a missing match) on a denied card show
    // in the answer, as a `denied` entry or in the paging, so a caller could probe text it may
    // not read. The answer never lists denied cards; only an explicit id lookup answers for one.
    const matches = matcherOf(query);
    const cards: Card[] = [];
    let cursor = query['cursor'] ? str(query['cursor']) : undefined;
    for (let pages = 0; pages < MAX_SEARCH_PAGES; pages++) {
      const page = await s.storage.list({
        ...(query['worldId'] ? { worldId: str(query['worldId']) } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
      });
      const { allowed } = await s.gate.filter(page.items, target);
      cards.push(...allowed.filter(matches));
      cursor = page.nextCursor;
      if (cards.length > 0 || cursor === undefined) break;
    }
    return ok({ cards, ...(cursor !== undefined ? { nextCursor: cursor } : {}) });
  },

  async card_get(s, { principal, params }) {
    const card = await visibleCard(s, principal, str(params['cardId']));
    if (!card) throw new HttpError(404, 'unknown card');
    return ok(card);
  },

  async stance_get(s, { params }) {
    const stance = await stanceFor(s, str(params['cardId']));
    if (!stance) throw new HttpError(404, 'no stance on this card');
    return ok(stance);
  },

  async stance_save(s, { params, body }) {
    const cardId = str(params['cardId']);
    if (!(await s.storage.read(cardId))) throw new HttpError(404, 'unknown card');
    return ok(await s.localState.saveStance(cardId, body as StanceInput));
  },

  async context_package_get(s, { principal, body }) {
    return ok(await buildContextPackage(s, principal, body as ContextPackageRequest));
  },

  async rules_evaluate(s, { principal, body }) {
    return ok(await evaluateRules(s, principal, (body as { lageId: string }).lageId));
  },

  async proposal_list(s, { principal, query }) {
    const page = await s.localState.listProposals({
      ...(query['status'] ? { status: query['status'] as 'pending' } : {}),
      ...(query['lageId'] ? { lageId: str(query['lageId']) } : {}),
      ...(query['limit'] !== undefined ? { limit: query['limit'] as number } : {}),
      ...(query['cursor'] ? { cursor: str(query['cursor']) } : {}),
      ...(query['changedSince'] ? { changedSince: str(query['changedSince']) } : {}),
    });
    // A cloud_model connection sees only its own proposals: another agent's proposal may carry
    // text derived from cards that connection may not receive.
    const proposals =
      principal.kind === 'agent' && principal.target === 'cloud_model'
        ? page.proposals.filter((p) => p.author === principal.author)
        : page.proposals;
    return ok({
      proposals,
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    });
  },

  async proposal_create(s, { principal, body }) {
    if (principal.kind !== 'agent') throw new HttpError(403, 'only an agent proposes');
    const input = body as ProposalCreate;
    if (input.kind === 'create_card') {
      const draft = (input.payload as { card: CardDraft }).card;
      const forbidden = forbiddenDraftFields(draft);
      if (forbidden.length > 0) {
        throw new HttpError(400, `an agent may not set ${forbidden.join(', ')} on a card`);
      }
    }
    return ok(await s.localState.createProposal(input, principal.author), 201);
  },

  async proposal_accept(s, { params }) {
    const id = str(params['proposalId']);
    const proposal = await s.writes.run(async () => {
      const current = await s.localState.getProposal(id);
      if (!current) throw new HttpError(404, 'unknown proposal');
      if (current.status !== 'pending') throw new HttpError(409, 'the proposal is already decided');
      await applyProposal(s, current);
      return s.localState.decideProposal(id, 'accepted');
    });
    return ok(proposal);
  },

  async proposal_reject(s, { params }) {
    const id = str(params['proposalId']);
    return ok(await s.writes.run(() => s.localState.decideProposal(id, 'rejected')));
  },

  async decision_create(s, { body }) {
    const draft = body as DecisionDraft;
    await requireCards(s, draft.sections.cardsUsed, 'cardsUsed');
    const id = await s.writes.run(() => s.storage.create(draft, 'human'));
    return ok(await s.storage.read(id), 201);
  },

  async decision_save(s, { params, body }) {
    const id = str(params['cardId']);
    const next = body as Card;
    if (next.id !== id) throw new HttpError(400, 'the id in the body differs from the path');
    await requireCards(s, next.sections?.cardsUsed ?? [], 'cardsUsed');
    await s.writes.run(async () => {
      const stored = await s.storage.read(id);
      if (stored?.type !== 'decision') throw new HttpError(404, 'unknown decision');
      if (next.contentHash !== stored.contentHash) {
        throw new HttpError(409, 'the decision changed since it was read');
      }
      const patch = Object.fromEntries(
        Object.entries(next).filter(([key]) => !NOT_PATCHABLE.has(key)),
      ) as CardPatch;
      await s.storage.patch(id, patch, { contentHash: stored.contentHash });
    });
    return ok(await s.storage.read(id));
  },

  async disclosure_transfer_preview(s, { body }) {
    const req = body as DisclosurePreviewRequest;
    const cards = await requireCards(s, req.cardIds, 'cardIds');
    const transfer = await s.disclosures.preview({
      connectorId: req.connectorId,
      purpose: req.purpose,
      request: req.request,
      cards,
      requester: { kind: 'board' },
    });
    if (!transfer) throw new HttpError(400, 'no card of this transfer is cleared for cloud_model');
    return ok(transfer, 201);
  },

  async disclosure_transfer_get(s, { params }) {
    const transfer = s.disclosures.get(str(params['transferId']));
    if (!transfer) throw new HttpError(404, 'unknown or expired transfer');
    return ok(transfer);
  },

  async disclosure_confirm(s, { params, body }) {
    const { payloadHash } = body as DisclosureConfirmRequest;
    return ok(await s.disclosures.confirm(str(params['transferId']), payloadHash));
  },
};
