// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The human-only what-if operations (ADR-0050). None is an MCP tool. The access rule comes from
// the contract (`x-human-only`). Replacing the layer writes no card. Attaching copies the layer
// into the state directory and does not patch the decision.

import type { ScenarioAttachRequest, ScenarioReplace } from '@worldbuilder/core';
import { targetOf, type Principal } from './auth.js';
import { readLage } from './lage.js';
import type { Handler } from './operations.js';
import { HttpError } from './problem.js';
import type { Services } from './services.js';

const str = (v: unknown): string => v as string;

async function requireLage(s: Services, principal: Principal, lageId: string): Promise<void> {
  const lage = await readLage(s, lageId);
  if (!lage) throw new HttpError(404, 'unknown Lage');
  const visible = (await s.gate.decide(lage, targetOf(principal))).decision === 'allow';
  if (!visible) throw new HttpError(404, 'unknown Lage');
}

async function requireDecision(
  s: Services,
  principal: Principal,
  decisionId: string,
): Promise<void> {
  const card = await s.storage.read(decisionId);
  if (card?.type !== 'decision') throw new HttpError(404, 'unknown decision');
  const visible = (await s.gate.decide(card, targetOf(principal))).decision === 'allow';
  if (!visible) throw new HttpError(404, 'unknown decision');
}

export const scenarioHandlers: Readonly<Record<string, Handler>> = {
  async scenario_get(s, { principal, params }) {
    const lageId = str(params['lageId']);
    await requireLage(s, principal, lageId);
    return { status: 200, body: { assumptions: s.scenario.get(lageId) } };
  },

  async scenario_replace(s, { principal, params, body }) {
    const lageId = str(params['lageId']);
    await requireLage(s, principal, lageId);
    const statements = (body as ScenarioReplace).assumptions.map((item) => item.statement);
    return { status: 200, body: { assumptions: s.scenario.replace(lageId, statements) } };
  },

  async scenario_attach(s, { principal, params, body }) {
    const lageId = str(params['lageId']);
    await requireLage(s, principal, lageId);
    const decisionId = (body as ScenarioAttachRequest).decisionId;
    await requireDecision(s, principal, decisionId);
    const assumptions = s.scenario.get(lageId).map((item) => ({ ...item }));
    if (assumptions.length === 0) throw new HttpError(400, 'the what-if layer is empty');
    const saved = await s.localState.saveScenarioAttachment({ decisionId, assumptions });
    return { status: 200, body: saved };
  },

  async scenario_attachment_get(s, { principal, params }) {
    const decisionId = str(params['decisionId']);
    await requireDecision(s, principal, decisionId);
    const saved = await s.localState.getScenarioAttachment(decisionId);
    if (!saved) throw new HttpError(404, 'no what-if attached to this decision');
    return { status: 200, body: saved };
  },
};
