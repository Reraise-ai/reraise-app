// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Human-only model_ask (ADR-0015, ADR-0031). Ollama is a local model: the gate-cleared
// cards on the Lage go to it and the answer is stored as a pending comment. A cloud
// connector is not called until the human has confirmed the transfer. The connector
// itself also refuses a cloud call without that release.

import {
  ModelCallError,
  computePayloadHash,
  independenceOf,
  originRoots,
  type Card,
  type ContextPackage,
  type DisclosurePreviewEnvelope,
  type DisclosureRelease,
  type ModelAskRequest,
  type ModelAskResult,
  type ModelConnector,
  type Proposal,
} from '@worldbuilder/core';
import type { Handler } from './operations.js';
import { HttpError } from './problem.js';
import { proposalNotice } from './live.js';
import { readLage } from './lage.js';
import type { LageCard, Services } from './services.js';

const str = (v: unknown): string => v as string;

function fail(e: unknown): never {
  if (e instanceof ModelCallError) {
    const status =
      e.code === 'release_required'
        ? 403
        : e.code === 'not_configured'
          ? 404
          : e.code === 'request_too_large'
            ? 413
            : 502;
    throw new HttpError(status, e.message);
  }
  throw new HttpError(502, 'the model did not answer');
}

async function boardOf(s: Services, lageId: string): Promise<{ lage: LageCard; cards: Card[] }> {
  const lage = await readLage(s, lageId);
  if (!lage) throw new HttpError(404, 'unknown Lage');
  if ((await s.gate.decide(lage, 'screen')).decision !== 'allow') {
    throw new HttpError(404, 'unknown Lage');
  }
  const cards: Card[] = [];
  for (const place of lage.lage.cards) {
    const card = await s.storage.read(place.id);
    if (card?.uri) cards.push(card);
  }
  return { lage, cards };
}

function packageOf(
  s: Services,
  lage: LageCard,
  target: ContextPackage['target'],
  question: string,
  cards: readonly Card[],
  withheld: number,
): ContextPackage {
  const worldId = lage.worlds?.[0];
  if (!worldId) throw new HttpError(404, 'unknown Lage');
  const roots = originRoots(cards);
  return {
    id: lage.id,
    target,
    worldId,
    lageId: lage.id,
    question,
    createdAt: s.now().toISOString(),
    items: cards.map((card) => {
      const root = roots.get(card.id);
      return {
        card,
        provenance: {
          uri: card.uri as string,
          ...(card.source !== undefined ? { source: card.source } : {}),
          originRoot: root?.originRoot ?? card.id,
          originKnown: root?.originKnown ?? false,
        },
        gate: { decision: 'allow' as const, reason: 'cleared for the model' },
      };
    }),
    independence: independenceOf([...roots.values()]),
    pendingProposals: [],
    withheld,
  };
}

async function storeAnswer(
  s: Services,
  connector: ModelConnector,
  lageId: string,
  pkg: ContextPackage,
  question: string,
  release?: DisclosureRelease,
): Promise<Proposal> {
  let answer;
  try {
    answer = await connector.ask(pkg, question, release);
  } catch (e) {
    fail(e);
  }
  const first = answer.proposals[0];
  if (first?.kind !== 'comment') throw new HttpError(502, 'the model answer could not be read');
  const created = await s.localState.createProposal(
    { kind: 'comment', payload: { text: first.payload.text, lageId } },
    `agent:${connector.engine}`,
  );
  s.live.publish(proposalNotice(created.payload));
  return created;
}

async function clearedForCloud(s: Services, cards: readonly Card[]): Promise<Card[]> {
  const kept: Card[] = [];
  for (const card of cards) if (await s.gate.clears(card, 'cloud_model')) kept.push(card);
  return kept;
}

/**
 * A cloud connector with no address refuses before any request. A configured one refuses
 * an empty package, because that package has no release. Either way nothing is sent.
 */
async function ensureConfigured(
  connector: ModelConnector,
  pkg: ContextPackage,
  question: string,
): Promise<void> {
  try {
    await connector.ask(pkg, question);
  } catch (e) {
    if (e instanceof ModelCallError && e.code === 'release_required') return;
    fail(e);
  }
  throw new HttpError(502, 'the model answer could not be read');
}

function envelope(
  engine: string,
  question: string,
  cards: readonly Card[],
): DisclosurePreviewEnvelope {
  return { target: 'cloud_model', connectorId: engine, request: { question }, objects: [...cards] };
}

export const modelHandlers: Readonly<Record<string, Handler>> = {
  async model_ask(s, { params, body }): Promise<{ status: number; body: ModelAskResult }> {
    const lageId = str(params['lageId']);
    const req = body as ModelAskRequest;
    const connector = s.models.get(req.engine);
    if (!connector) throw new HttpError(404, 'this model is not configured');
    const { lage, cards } = await boardOf(s, lageId);

    if (connector.target === 'local_model') {
      const filtered = await s.gate.filter(cards, 'local_model');
      const proposal = await storeAnswer(
        s,
        connector,
        lageId,
        packageOf(s, lage, 'local_model', req.question, filtered.allowed, filtered.denied.length),
        req.question,
      );
      return { status: 200, body: { status: 'proposed', engine: req.engine, proposal } };
    }

    const cleared = await clearedForCloud(s, cards);
    if (req.transferId === undefined) {
      await ensureConfigured(
        connector,
        packageOf(s, lage, 'cloud_model', req.question, [], 0),
        req.question,
      );
      if (cleared.length === 0) {
        return { status: 200, body: { status: 'nothing_cleared', engine: req.engine } };
      }
      const transfer = await s.disclosures.preview({
        connectorId: req.engine,
        purpose: 'context_package',
        request: { question: req.question },
        cards: cleared,
        requester: { kind: 'board' },
      });
      if (!transfer) {
        throw new HttpError(403, 'the gate rules clear no card of this Lage for a cloud model');
      }
      return {
        status: 200,
        body: { status: 'confirmation_required', engine: req.engine, transfer },
      };
    }

    const transfer = s.disclosures.get(req.transferId);
    const requester = s.disclosures.requesterOf(req.transferId);
    if (
      !transfer ||
      transfer.purpose !== 'context_package' ||
      requester?.kind !== 'board' ||
      transfer.preview.connectorId !== req.engine
    ) {
      throw new HttpError(403, 'unknown, expired or unconfirmed transfer');
    }
    if (computePayloadHash(envelope(req.engine, req.question, cleared)) !== transfer.payloadHash) {
      throw new HttpError(409, 'the board changed since the preview; preview the transfer again');
    }
    const release = await s.disclosures.redeem(
      req.transferId,
      {
        kind: 'token',
        token: req.confirmationToken as string,
      },
      req.question,
    );
    const proposal = await storeAnswer(
      s,
      connector,
      lageId,
      packageOf(s, lage, 'cloud_model', req.question, release.objects, 0),
      req.question,
      release,
    );
    return { status: 200, body: { status: 'proposed', engine: req.engine, proposal } };
  },
};
