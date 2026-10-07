// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The checks every agent proposal passes, whichever tool creates it (`proposal_create`,
// `knowledge_write_back`, `decision_record`, `decision_outcome`; ADR-0011, ADR-0039): one
// helper, so the tools cannot differ. An agent may only refer to cards the gate clears for its
// own target, and unknown and hidden look alike.

import type { Card, CardDraft, ProposalCreate } from '@worldbuilder/core';
import { targetOf, type Principal } from './auth.js';
import { HttpError } from './problem.js';
import { draftProblem } from './proposals.js';
import type { Services } from './services.js';

/**
 * A card the caller may know about: it exists and the rules clear it for the caller's target
 * (for a cloud_model connection: cleared after a confirmed transfer).
 */
export async function clearedCard(
  s: Services,
  p: Principal,
  id: string,
): Promise<Card | undefined> {
  const card = await s.storage.read(id);
  return card && (await s.gate.clears(card, targetOf(p))) ? card : undefined;
}

export async function requireCleared(
  s: Services,
  p: Principal,
  ids: readonly string[],
  what: string,
): Promise<void> {
  for (const id of ids) {
    if (!(await clearedCard(s, p, id))) throw new HttpError(400, `${what}: unknown card ${id}`);
  }
}

/**
 * Throws the problem an agent proposal deserves before it is stored: a forbidden draft field or
 * a foreign edge (400); a decision draft that uses cards the agent may not know (400); an
 * outcome for a decision the agent may not know (404, like an unknown decision).
 */
export async function assertAgentProposal(
  s: Services,
  agent: Principal & { kind: 'agent' },
  input: ProposalCreate,
): Promise<void> {
  if (input.kind === 'create_card') {
    const card = (input.payload as { card: CardDraft }).card;
    const problem = draftProblem(card, agent.author);
    if (problem) throw new HttpError(400, problem);
    if (card.type === 'decision') {
      const used = (card as { sections?: { cardsUsed?: string[] } }).sections?.cardsUsed ?? [];
      await requireCleared(s, agent, used, 'cardsUsed');
    }
  } else if (input.kind === 'record_outcome') {
    const decision = await clearedCard(s, agent, input.payload.decisionId);
    if (decision?.type !== 'decision') throw new HttpError(404, 'unknown decision');
  }
}
