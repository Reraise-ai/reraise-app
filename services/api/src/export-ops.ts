// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Human-only training_export (ADR-0017, ADR-0031). Builds JSONL of opted-in decision traces
// and sends nothing until the human confirms that one cloud transfer. Stance data is never
// in a trace.

import {
  type Card,
  type DisclosurePreviewEnvelope,
  type Proposal,
  type TrainingExportRecord,
  type TrainingExportRequest,
  type TrainingExportResult,
} from '@worldbuilder/core';
import { buildTrainingRecord, toJsonl } from '@worldbuilder/training-export';
import type { Handler } from './operations.js';
import { HttpError } from './problem.js';
import { collect, isLageCard, type Services } from './services.js';

const CONNECTOR = 'training-export';
const MAX_CARDS = 5000;

function envelope(cards: readonly Card[]): DisclosurePreviewEnvelope {
  const objects = [...cards].sort((a, b) => a.id.localeCompare(b.id));
  return { target: 'cloud_model', connectorId: CONNECTOR, request: {}, objects };
}

async function allCards(s: Services): Promise<Card[]> {
  return collect(
    (cursor) => s.storage.list({ limit: 200, ...(cursor ? { cursor } : {}) }),
    MAX_CARDS,
  );
}

async function acceptedMoves(s: Services): Promise<Proposal[]> {
  const out: Proposal[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 25; page++) {
    const listed = await s.localState.listProposals({
      status: 'accepted',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    out.push(...listed.proposals);
    if (listed.proposals.length < 200 || listed.nextCursor === undefined) break;
    cursor = listed.nextCursor;
  }
  return out;
}

async function tracesOf(
  s: Services,
): Promise<{ records: TrainingExportRecord[]; objects: Card[] }> {
  const cards = await allCards(s);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const brainstorm = await acceptedMoves(s);
  const exportedAt = s.now().toISOString();
  const records: TrainingExportRecord[] = [];
  const objectIds = new Set<string>();

  for (const decision of cards) {
    if (decision.type !== 'decision') continue;
    if (!(await s.gate.clears(decision, 'cloud_model'))) continue;
    const used: Card[] = [];
    for (const id of decision.sections?.cardsUsed ?? []) {
      const card = byId.get(id);
      if (!card) continue;
      if (!(await s.gate.clears(card, 'cloud_model'))) continue;
      used.push(card);
    }
    const lage = cards.find(
      (card) =>
        isLageCard(card) &&
        (decision.worlds ?? []).some((world) => card.worlds?.includes(world)) &&
        card.training === true,
    );
    const lageOk =
      lage !== undefined && (await s.gate.clears(lage, 'cloud_model')) ? lage : undefined;
    const built = buildTrainingRecord({
      decision,
      cards: [...used, ...(lageOk ? [lageOk] : [])],
      ...(lageOk ? { lage: lageOk } : {}),
      brainstorm,
      exportedAt,
    });
    if (!built.record) continue;
    records.push(built.record);
    objectIds.add(decision.id);
    for (const card of built.record.usedCards) objectIds.add(card.id);
    if (built.record.lage) objectIds.add(built.record.lage.id);
  }

  const objects = [...objectIds].sort().flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
  return { records, objects };
}

export const exportHandlers: Readonly<Record<string, Handler>> = {
  async training_export(s, { body }): Promise<{ status: number; body: TrainingExportResult }> {
    const req = (body ?? {}) as TrainingExportRequest;
    const { records, objects } = await tracesOf(s);

    if (req.transferId === undefined) {
      if (objects.length === 0) return { status: 200, body: { status: 'nothing_to_export' } };
      const transfer = await s.disclosures.preview({
        connectorId: CONNECTOR,
        purpose: 'export',
        request: {},
        cards: objects,
        requester: { kind: 'board' },
      });
      if (!transfer) return { status: 200, body: { status: 'nothing_to_export' } };
      return { status: 200, body: { status: 'confirmation_required', transfer } };
    }

    const transfer = s.disclosures.get(req.transferId);
    const requester = s.disclosures.requesterOf(req.transferId);
    if (
      !transfer ||
      transfer.purpose !== 'export' ||
      requester?.kind !== 'board' ||
      transfer.preview.connectorId !== CONNECTOR
    ) {
      throw new HttpError(403, 'unknown, expired or unconfirmed transfer');
    }
    const current = envelope(objects);
    const previewed = [...transfer.cardIds].sort().join();
    if (current.objects.length === 0 || current.objects.map((c) => c.id).join() !== previewed) {
      throw new HttpError(409, 'the opted-in cards changed since the preview; preview again');
    }
    const release = await s.disclosures.redeem(req.transferId, {
      kind: 'token',
      token: req.confirmationToken as string,
    });
    const allowed = new Set(release.objects.map((card) => card.id));
    const kept = records.filter(
      (record) =>
        allowed.has(record.decision.id) && record.usedCards.every((card) => allowed.has(card.id)),
    );
    if (kept.length === 0) {
      throw new HttpError(409, 'the opted-in cards changed since the preview; preview again');
    }
    return {
      status: 200,
      body: { status: 'exported', jsonl: toJsonl(kept), traces: kept.length },
    };
  },
};
