// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Context packages (ADR-0012, ADR-0024 item 34, ADR-0031): what a screen, a local model or a
// cloud model may know about a world, built after the gate. Stances appear only on the screen;
// a cloud_model caller gets content only from a confirmed transfer, released to that caller.

import {
  cardsForPackage,
  independenceOf,
  originRoots,
  type Card,
  type ContextItem,
  type ContextPackage,
  type ContextPackageRequest,
  type DisclosureTransfer,
} from '@worldbuilder/core';
import { connectionIdOf, targetOf, type Principal } from './auth.js';
import { readLage } from './lage.js';
import { HttpError } from './problem.js';
import { collect, stanceFor, type Services } from './services.js';
import { newUlid } from './util.js';

const DEFAULT_MAX_ITEMS = 100;

const connectorIdOf = (name: string): string =>
  `agent-${name.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`.slice(0, 64);

/** The cards a package is about: the cards placed on the Lage, else the cards of the world. */
async function scopeCards(
  s: Services,
  principal: Principal,
  req: ContextPackageRequest,
  max: number,
): Promise<Card[]> {
  if (req.lageId !== undefined) {
    const lage = await readLage(s, req.lageId);
    // Unknown, in another world, or (for a model) not cleared by the gate: one and the same
    // answer, so a model cannot tell a hidden Lage from a missing one (as rules_evaluate).
    if (!lage || !lage.worlds?.includes(req.worldId) || !(await lageCleared(s, principal, lage))) {
      throw new HttpError(404, 'unknown Lage');
    }
    const cards: Card[] = [];
    for (const placement of lage.lage.cards.slice(0, max)) {
      const card = await s.storage.read(placement.id);
      if (card) cards.push(card);
    }
    return cards;
  }
  return collect(
    (cursor) => s.storage.list({ worldId: req.worldId, limit: 200, ...(cursor ? { cursor } : {}) }),
    max,
  );
}

/**
 * May this caller know the Lage exists? The screen always may. A model target needs the rules
 * to clear the Lage card; for a cloud_model connection "cleared" is the gate's answer that the
 * card could go out after the human confirmed the transfer.
 */
async function lageCleared(s: Services, principal: Principal, lage: Card): Promise<boolean> {
  const target = targetOf(principal);
  if (target === 'screen') return true;
  const d = await s.gate.decide(lage, target);
  return d.decision === 'allow' || (target === 'cloud_model' && d.confirmationRequired === true);
}

async function pendingProposals(s: Services, lageId: string | undefined) {
  const page = await s.localState.listProposals({
    status: 'pending',
    limit: 200,
    ...(lageId ? { lageId } : {}),
  });
  return page.proposals.map((p) => ({ proposalId: p.id, kind: p.kind }));
}

function itemsOf(cards: readonly Card[], reason: (c: Card) => string): ContextItem[] {
  const roots = originRoots(cards);
  return cards.map((card) => {
    const root = roots.get(card.id)!;
    return {
      card,
      provenance: {
        uri: card.uri,
        ...(card.source !== undefined ? { source: card.source } : {}),
        ...(card.sourceDate !== undefined ? { sourceDate: card.sourceDate } : {}),
        ...(card.originSystem !== undefined ? { originSystem: card.originSystem } : {}),
        originRoot: root.originRoot,
        originKnown: root.originKnown,
      },
      gate: { decision: 'allow' as const, reason: reason(card) },
    };
  });
}

export async function buildContextPackage(
  s: Services,
  principal: Principal,
  req: ContextPackageRequest,
): Promise<ContextPackage> {
  const target = targetOf(principal);
  const max = req.maxItems ?? DEFAULT_MAX_ITEMS;
  const base = {
    id: newUlid(),
    worldId: req.worldId,
    ...(req.lageId !== undefined ? { lageId: req.lageId } : {}),
    createdAt: s.now().toISOString(),
  };

  // A board send to a cloud model: the human session with a confirmed transfer and its token.
  if (principal.kind === 'human' && (req.transferId !== undefined || req.confirmationToken)) {
    if (req.transferId === undefined || req.confirmationToken === undefined) {
      throw new HttpError(400, 'a board send needs both transferId and confirmationToken');
    }
    return released(
      base,
      req,
      await s.disclosures.redeem(
        req.transferId,
        { kind: 'token', token: req.confirmationToken },
        req.question,
      ),
    );
  }

  if (principal.kind === 'agent') {
    if (req.confirmationToken !== undefined) {
      throw new HttpError(400, 'agents never carry a confirmation token');
    }
    if (principal.target === 'cloud_model') return cloudPackage(s, principal, base, req, max);
    if (req.transferId !== undefined) {
      throw new HttpError(400, 'only a cloud_model connection uses a transferId');
    }
  } else if (req.transferId !== undefined) {
    throw new HttpError(400, 'a board send needs both transferId and confirmationToken');
  }

  // Screen and local_model: the cards the rules clear for this target.
  const cards = await scopeCards(s, principal, req, max);
  const filtered = await s.gate.filter(cards, target);
  const { allowed } = filtered;
  // A model target learns nothing of a world with no card cleared for it: it looks exactly like
  // an unknown world (no count, no ids). A Lage was already checked above.
  const denied =
    target !== 'screen' && req.lageId === undefined && allowed.length === 0 ? [] : filtered.denied;
  // A model package names only cards it contains. The screen keeps the stored cards.
  const view = cardsForPackage(allowed, target);
  const items = itemsOf(view.cards, () => 'cleared by the gate rules');
  if (target === 'screen') {
    for (const item of items) {
      const stance = await stanceFor(s, item.card.id);
      // The stance is its own gate item: allowed for the screen only, whatever the rules say.
      if (stance && (await s.gate.decide(item.card, 'screen', 'stance')).decision === 'allow') {
        item.stance = stance;
      }
    }
  }
  return {
    ...base,
    target,
    ...(req.question !== undefined ? { question: req.question } : {}),
    items,
    independence: independenceOf(items.map((item) => item.provenance)),
    pendingProposals: await pendingProposals(s, req.lageId),
    withheld: denied.length + view.withheld,
    ...(denied.length > 0 ? { denied } : {}),
  };
}

/**
 * The content of one released transfer: exactly the confirmed objects, nothing else.
 * shortcut: those objects are the stored cards, so a Lage edge can still name a card the
 * transfer does not include. Project the cards before the preview hash when a cloud
 * package must not name a card outside the transfer.
 */
function released(
  base: Pick<ContextPackage, 'id' | 'worldId' | 'createdAt'> & { lageId?: string },
  req: ContextPackageRequest,
  release: Awaited<ReturnType<Services['disclosures']['redeem']>>,
): ContextPackage {
  const items = itemsOf(
    release.objects,
    () => `confirmed transfer ${release.confirmation.transferId}`,
  );
  return {
    ...base,
    target: 'cloud_model',
    ...(req.question !== undefined ? { question: req.question } : {}),
    items,
    independence: independenceOf(items.map((item) => item.provenance)),
    pendingProposals: [],
    withheld: 0,
    transfer: release.confirmation,
  };
}

async function cloudPackage(
  s: Services,
  principal: Principal & { kind: 'agent' },
  base: Pick<ContextPackage, 'id' | 'worldId' | 'createdAt'> & { lageId?: string },
  req: ContextPackageRequest,
  max: number,
): Promise<ContextPackage> {
  const connectionId = connectionIdOf(principal);
  if (req.transferId !== undefined) {
    const requester = s.disclosures.requesterOf(req.transferId);
    const transfer = s.disclosures.get(req.transferId);
    if (
      requester?.kind !== 'connection' ||
      requester.connectionId !== connectionId ||
      transfer?.purpose !== 'context_package'
    ) {
      throw new HttpError(403, 'unknown, expired or unconfirmed transfer');
    }
    return released(
      base,
      req,
      await s.disclosures.redeem(
        req.transferId,
        { kind: 'connection', connectionId },
        req.question,
      ),
    );
  }

  // First call: no content. Ask the human to confirm exactly what would be sent.
  let cards = await scopeCards(s, principal, req, max);
  if (req.lageId === undefined) {
    // No card of the world cleared for this connection: answer as for an unknown world.
    const cleared: Card[] = [];
    for (const card of cards) if (await s.gate.clears(card, 'cloud_model')) cleared.push(card);
    if (cleared.length === 0) cards = [];
  }
  const { denied } = await s.gate.filter(cards, 'cloud_model'); // logs; cloud never passes decide
  let transfer: DisclosureTransfer | undefined;
  if (cards.length > 0) {
    transfer = await s.disclosures.preview({
      connectorId: connectorIdOf(principal.name),
      purpose: 'context_package',
      request: req.question !== undefined ? { question: req.question } : {},
      cards,
      requester: { kind: 'connection', connectionId },
    });
  }
  return {
    ...base,
    target: 'cloud_model',
    items: [],
    independence: { findings: 0, origins: 0 },
    pendingProposals: [],
    withheld: cards.length,
    ...(transfer ? { confirmationRequired: { transferId: transfer.transferId } } : {}),
    ...(denied.length > 0 ? { denied } : {}),
  };
}
