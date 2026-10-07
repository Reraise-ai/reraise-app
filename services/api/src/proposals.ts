// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Applying an accepted proposal (ADR-0011): the change is written through the StorageAdapter
// and the author of the proposal stays the author of the resulting edge or card. Nothing is
// written before a human accepted. Every refusal is a 409 and leaves the proposal pending.

import type {
  AddEdgePayload,
  CardDraft,
  CreateCardPayload,
  MoveCardPayload,
  PlaceCardPayload,
  Proposal,
} from '@worldbuilder/core';
import { HttpError } from './problem.js';
import { readLage, withPlacement, writeLageVersion } from './lage.js';
import type { Services } from './services.js';

/**
 * Card fields an agent may not set: they decide who can see a card (`visibility`, `worlds`),
 * how the rules and the gate treat it (`class`, `tags`), where it may be sent and whether it is
 * used for training (`release`, `training`, ADR-0012, ADR-0017, ADR-0036), or carry the user's
 * own judgement (`rating`). They stay at their private defaults until the human changes them;
 * a card created from an accepted proposal joins the worlds of the Lage it is placed on.
 */
export const AGENT_FORBIDDEN_DRAFT_FIELDS = [
  'worlds',
  'tags',
  'rating',
  'class',
  'visibility',
  'release',
  'training',
] as const;

export function forbiddenDraftFields(draft: CardDraft): string[] {
  return AGENT_FORBIDDEN_DRAFT_FIELDS.filter((f) => f in draft);
}

/**
 * Edges of a draft an agent proposes must be the agent's own: `by` is the proposal author. An
 * edge attributed to the human (or to anyone else) would pass the agent's judgement off as the
 * user's (ADR-0009, ADR-0011). Returns the reason, or undefined when the draft is fine.
 */
export function draftEdgeProblem(draft: CardDraft, author: string): string | undefined {
  const foreign = (draft.edges ?? []).filter((e) => e.by !== author);
  return foreign.length === 0
    ? undefined
    : `an edge of a proposed card must be drawn by ${author}, not by ${foreign[0]!.by}`;
}

/** Everything that makes a created-card draft unacceptable from this author, or undefined. */
export function draftProblem(draft: CardDraft, author: string): string | undefined {
  const forbidden = forbiddenDraftFields(draft);
  if (forbidden.length > 0) return `an agent may not set ${forbidden.join(', ')} on a card`;
  return draftEdgeProblem(draft, author);
}

async function requireCard(s: Services, id: string, what: string): Promise<void> {
  if (!(await s.storage.read(id))) throw new HttpError(409, `${what} does not exist`);
}

async function requireLage(s: Services, id: string) {
  const lage = await readLage(s, id);
  if (!lage) throw new HttpError(409, 'the Lage does not exist');
  return lage;
}

export async function applyProposal(s: Services, p: Proposal): Promise<void> {
  switch (p.kind) {
    case 'place_card': {
      const { lageId, cardId, x, y } = p.payload as unknown as PlaceCardPayload;
      await requireLage(s, lageId);
      await requireCard(s, cardId, 'the card');
      await writeLageVersion(s, lageId, (lage) => withPlacement(lage, cardId, x, y));
      return;
    }
    case 'move_card': {
      const { lageId, cardId, x, y } = p.payload as unknown as MoveCardPayload;
      const lage = await requireLage(s, lageId);
      if (!lage.lage.cards.some((c) => c.id === cardId)) {
        throw new HttpError(409, 'the card is not placed on the Lage');
      }
      await writeLageVersion(s, lageId, (l) => withPlacement(l, cardId, x, y));
      return;
    }
    case 'add_edge': {
      const { lageId, from, to, kind } = p.payload as unknown as AddEdgePayload;
      await requireCard(s, from, 'the source card');
      await requireCard(s, to, 'the target card');
      if (lageId !== undefined) {
        const lage = await requireLage(s, lageId);
        const placed = new Set(lage.lage.cards.map((c) => c.id));
        if (!placed.has(from) || !placed.has(to)) {
          throw new HttpError(409, 'both cards must be placed on the Lage');
        }
        if (lage.lage.edges.some((e) => e.from === from && e.to === to && e.kind === kind)) return;
        await writeLageVersion(s, lageId, (l) => ({
          ...l,
          edges: [...l.edges, { from, to, kind, by: p.author }],
        }));
        return;
      }
      const source = await s.storage.read(from);
      const edges = source?.edges ?? [];
      if (edges.some((e) => e.target === to && e.kind === kind)) return;
      await s.storage.patch(from, { edges: [...edges, { target: to, kind, by: p.author }] });
      return;
    }
    case 'create_card': {
      const { card, lageId, x, y } = p.payload as unknown as CreateCardPayload;
      // Checked again here: the stored payload is what gets written, whatever happened since.
      const problem = draftProblem(card, p.author);
      if (problem) throw new HttpError(409, problem);
      const lage = lageId !== undefined ? await requireLage(s, lageId) : undefined;
      const worlds = lage?.worlds;
      const id = await s.storage.create(
        worlds && worlds.length > 0 ? { ...card, worlds } : card,
        p.author,
      );
      if (lageId !== undefined && x !== undefined && y !== undefined) {
        await writeLageVersion(s, lageId, (l) => withPlacement(l, id, x, y));
      }
      return;
    }
    case 'comment':
      // M1 keeps no comment store: accepting records the decision on the proposal only.
      return;
  }
}
