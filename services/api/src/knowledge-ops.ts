// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The knowledge-loop operations (ADR-0039 to ADR-0042): consult with a receipt, write-back
// with a receipt, decision and outcome proposals, memory routing and the usage metrics. None
// is a new read or write path: a consult is a context package, every agent write ends in a
// proposal that a human accepts, and receipts hold ids, hashes and codes only.

import type {
  CardDraft,
  DecisionOutcomeRequest,
  DecisionRecordRequest,
  KnowledgeConsultRequest,
  MemoryRouteRequest,
  ProposalCreate,
  TaskRecord,
  WriteBackRequest,
} from '@worldbuilder/core';
import {
  computeUsageMetrics,
  createKnowledgeReceipt,
  createWriteBackReceipt,
  isoWeekRange,
  parseTaskRecord,
  routeMemory,
  verifyAgainstChain,
  type Receipt,
} from '@worldbuilder/knowledge-loop';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { proposalNotice } from './live.js';
import type { Principal } from './auth.js';
import { buildContextPackage } from './context.js';
import type { Handler } from './operations.js';
import { HttpError } from './problem.js';
import { assertAgentProposal, requireCleared } from './agent-checks.js';
import { ReceiptLogError } from './receipts.js';
import { collect, type Services } from './services.js';
import { newUlid } from './util.js';

const ok = (body: unknown, status = 200) => ({ status, body });

function agentOf(p: Principal): Principal & { kind: 'agent' } {
  if (p.kind !== 'agent') throw new HttpError(403, 'this operation is for registered agents only');
  return p;
}

/** The proposal of a card (a create_card), after the checks every agent draft passes. */
async function proposeCard(
  s: Services,
  principal: Principal & { kind: 'agent' },
  card: CardDraft,
  placement: { lageId?: string; x?: number; y?: number },
  rationale: string | undefined,
) {
  const input = {
    kind: 'create_card',
    payload: {
      card,
      ...(placement.lageId !== undefined ? { lageId: placement.lageId } : {}),
      ...(placement.x !== undefined ? { x: placement.x } : {}),
      ...(placement.y !== undefined ? { y: placement.y } : {}),
    },
    ...(rationale !== undefined ? { rationale } : {}),
  } as unknown as ProposalCreate;
  await assertAgentProposal(s, principal, input);
  return s.localState.createProposal(input, principal.author);
}

async function readTaskRecords(dir: string): Promise<TaskRecord[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json') || n.endsWith('.md')).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const records: TaskRecord[] = [];
  for (const name of names) {
    try {
      records.push(parseTaskRecord(await readFile(path.join(dir, name), 'utf8'), name));
    } catch {
      // A file that is not a task record counts as no task (it proves nothing).
    }
  }
  return records;
}

/** Append a receipt; any failure is the 503 "Receipt log unavailable", never a bare 500. */
async function appendReceipt(s: Services, receipt: Receipt): Promise<void> {
  try {
    await s.receipts.append(receipt);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new ReceiptLogError('the receipt could not be written');
  }
}

export const knowledgeHandlers: Readonly<Record<string, Handler>> = {
  async knowledge_consult(s, { principal, body }) {
    const agent = agentOf(principal);
    const req = body as KnowledgeConsultRequest;
    // First make sure a receipt can be written: no content goes out without one.
    await s.receipts.ready();
    const pkg = await buildContextPackage(s, agent, {
      worldId: req.worldId,
      ...(req.lageId !== undefined ? { lageId: req.lageId } : {}),
      question: req.task,
      ...(req.maxItems !== undefined ? { maxItems: req.maxItems } : {}),
      ...(req.transferId !== undefined ? { transferId: req.transferId } : {}),
    });
    const receipt = createKnowledgeReceipt({
      receiptId: newUlid(),
      agent: agent.author,
      target: agent.target,
      taskRef: req.taskRef,
      task: req.task,
      queryKey: await s.receipts.queryKey(),
      worldId: req.worldId,
      ...(req.lageId !== undefined ? { lageId: req.lageId } : {}),
      package: pkg,
      at: s.now().toISOString(),
    });
    await appendReceipt(s, receipt);
    return ok({ package: pkg, receipt });
  },

  async knowledge_write_back(s, { principal, body }) {
    const agent = agentOf(principal);
    const req = body as WriteBackRequest;
    const base = {
      receiptId: newUlid(),
      agent: agent.author,
      taskRef: req.taskRef,
      ...(req.consultReceiptId !== undefined ? { consultReceiptId: req.consultReceiptId } : {}),
      at: s.now().toISOString(),
    };
    await s.receipts.ready();
    if ('notNeeded' in req && req.notNeeded) {
      await requireCleared(s, agent, req.notNeeded.coveredBy ?? [], 'coveredBy');
      const receipt = createWriteBackReceipt({ ...base, notNeeded: req.notNeeded });
      await appendReceipt(s, receipt);
      return ok({ receipt }, 201);
    }
    const card = (req as { card: CardDraft }).card;
    const proposal = await proposeCard(
      s,
      agent,
      card,
      { lageId: req.lageId, x: req.x, y: req.y } as never,
      req.rationale,
    );
    const receipt = createWriteBackReceipt({ ...base, proposalId: proposal.id, draft: card });
    try {
      await appendReceipt(s, receipt);
    } catch (e) {
      // No receipt, so the agent has no proof of the write-back: withdraw the proposal rather
      // than leave one the receipt log knows nothing about. (The schema records every decision
      // as the human's, so the rejection carries decidedBy "human".)
      await s.localState.decideProposal(proposal.id, 'rejected').catch(() => undefined);
      throw e;
    }
    s.live.publish(proposalNotice(proposal.payload));
    return ok({ receipt, proposal }, 201);
  },

  async decision_record(s, { principal, body }) {
    const agent = agentOf(principal);
    const req = body as DecisionRecordRequest;
    const decision = req.decision as unknown as CardDraft & {
      sections?: { cardsUsed?: string[] };
    };
    const proposal = await proposeCard(
      s,
      agent,
      decision,
      { lageId: req.lageId, x: req.x, y: req.y } as never,
      req.rationale,
    );
    s.live.publish(proposalNotice(proposal.payload));
    return ok(proposal, 201);
  },

  async decision_outcome(s, { principal, body }) {
    const agent = agentOf(principal);
    const req = body as DecisionOutcomeRequest;
    const input = {
      kind: 'record_outcome',
      payload: {
        decisionId: req.decisionId,
        outcome: req.outcome,
        expectedContentHash: req.expectedContentHash,
      },
      ...(req.rationale !== undefined ? { rationale: req.rationale } : {}),
    } as ProposalCreate;
    await assertAgentProposal(s, agent, input);
    const proposal = await s.localState.createProposal(input, agent.author);
    s.live.publish(proposalNotice(proposal.payload));
    return ok(proposal, 201);
  },

  async memory_route(_s, { body }) {
    return ok(routeMemory(body as MemoryRouteRequest));
  },

  async usage_metrics_get(s, { query }) {
    const week = query['week'] as string | undefined;
    if (week !== undefined) {
      try {
        isoWeekRange(week);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    const chain = await s.receipts.chain();
    if (!chain.ok) {
      throw new ReceiptLogError(`the receipt log is broken: ${chain.problems[0]?.message}`);
    }
    const records = await readTaskRecords(path.join(s.localState.stateDir, 'tasks'));
    const verified = verifyAgainstChain(records, chain);
    const proposals = await collect(async (cursor) => {
      const page = await s.localState.listProposals({
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      return {
        items: page.proposals,
        ...(page.proposals.length > 0 && page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    }, 100_000);
    const decisions = await collect(
      (cursor) => s.storage.search({ type: 'decision', limit: 200, ...(cursor ? { cursor } : {}) }),
      100_000,
    );
    return ok(
      computeUsageMetrics(
        {
          entries: chain.entries,
          tasks: verified.tasks.map((t, i) => ({ record: records[i]!, valid: t.ok })),
          proposals,
          decisions,
          // The atlas lag is measured by `wb metrics` (it reads the atlas pages); the service
          // reports it as unknown, so its target is not met rather than wrongly met.
          atlas: null,
        },
        { now: s.now(), ...(week !== undefined ? { week } : {}) },
      ),
    );
  },
};
