// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Context packages (ADR-0012, ADR-0024 item 34, ADR-0031): what a screen, a local model or a
// cloud model may know about a world, built after the gate. Stances appear only on the screen;
// a cloud_model caller gets content only from a confirmed transfer, released to that caller.

import type {
  Card,
  ContextItem,
  ContextPackage,
  ContextPackageRequest,
  ContextProvenance,
  DisclosureTransfer,
} from '@worldbuilder/core';
import { connectionIdOf, targetOf, type Principal } from './auth.js';
import { readLage } from './lage.js';
import { HttpError } from './problem.js';
import { collect, stanceFor, type Services } from './services.js';
import { newUlid } from './util.js';

const DEFAULT_MAX_ITEMS = 100;

/**
 * Provenance of one card (ADR-0009): its origin root is found by following cites and based_on
 * edges within the cleared cards until a card cites nothing further. A root with a source is
 * identified by that source, so two cards quoting one source share a root. A card whose chain
 * cannot be followed to a source is its own root and flagged as unknown.
 */
export function provenanceOf(card: Card, byId: ReadonlyMap<string, Card>): ContextProvenance {
  let root = card;
  const seen = new Set<string>([card.id]);
  for (;;) {
    const next = (root.edges ?? [])
      .filter((e) => e.kind === 'cites' || e.kind === 'based_on')
      .map((e) => byId.get(e.target))
      .find((c): c is Card => c !== undefined && !seen.has(c.id));
    if (!next) break;
    seen.add(next.id);
    root = next;
  }
  const known = root.source !== undefined;
  return {
    uri: card.uri,
    ...(card.source !== undefined ? { source: card.source } : {}),
    ...(card.sourceDate !== undefined ? { sourceDate: card.sourceDate } : {}),
    ...(card.originSystem !== undefined ? { originSystem: card.originSystem } : {}),
    originRoot: known ? root.source! : root.id,
    originKnown: known,
  };
}

const independenceOf = (items: readonly ContextItem[]) => ({
  findings: items.length,
  origins: new Set(items.map((i) => i.provenance.originRoot)).size,
});

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
      throw new HttpError(400, 'unknown Lage');
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
  const byId = new Map(cards.map((c) => [c.id, c] as const));
  return cards.map((card) => ({
    card,
    provenance: provenanceOf(card, byId),
    gate: { decision: 'allow' as const, reason: reason(card) },
  }));
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
  const { allowed, denied } = await s.gate.filter(cards, target);
  const items = itemsOf(allowed, () => 'cleared by the gate rules');
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
    independence: independenceOf(items),
    pendingProposals: await pendingProposals(s, req.lageId),
    withheld: denied.length,
    ...(denied.length > 0 ? { denied } : {}),
  };
}

/** The content of one released transfer: exactly the confirmed objects, nothing else. */
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
    independence: independenceOf(items),
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
  const cards = await scopeCards(s, principal, req, max);
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
