// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The knowledge loop over the service (ADR-0039 to ADR-0042): a consult leaves a receipt in the
// hash-chained log and that receipt verifies; write-backs and decisions are proposals only;
// an outcome patches one section under a hash precondition; receipts hold no content.

import type {
  Card,
  ContextPackage,
  DisclosureTransfer,
  KnowledgeReceipt,
  Proposal,
  TaskRecord,
  UsageMetrics,
  WriteBackReceipt,
} from '@worldbuilder/core';
import { computeContentHash } from '@worldbuilder/core';
import { checkChain, splitLogLines, verifyReceipts } from '@worldbuilder/knowledge-loop';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cardOf, expectContract, makeFixture, PRIVATE_TEXT, type Fixture } from './test-helpers.js';

let f: Fixture;
beforeAll(async () => {
  f = await makeFixture();
});
afterAll(async () => {
  await f.close();
});

const TASK_TEXT = 'Synthetic task: weigh the northern corridor SECRET-TASK-WORDS';
const logFile = () => path.join(f.stateDir, 'receipt-log.jsonl');
const logLines = async () => splitLogLines(await readFile(logFile(), 'utf8'));
const consult = (name: string, extra: object = {}) =>
  f.agent(name, 'POST', '/knowledge/consult', {
    taskRef: 'task:one',
    task: TASK_TEXT,
    worldId: f.worldId,
    ...extra,
  });
const draft = (title: string, extra: object = {}) => ({
  format: 2,
  type: 'claim',
  title,
  layer: 'said',
  originSystem: 'Synthetic agent',
  ...extra,
});
const sections = (cardsUsed: string[]) => ({
  situation: 'A synthetic situation.',
  trigger: 'A synthetic trigger.',
  conditions: 'Synthetic conditions.',
  facts: 'Synthetic facts.',
  priorities: 'Synthetic priorities.',
  action: 'Synthetic action.',
  alternatives: 'Synthetic alternatives.',
  exclusions: 'Synthetic exclusions.',
  rationale: 'Synthetic rationale.',
  cardsUsed,
  outcome: 'open',
});

describe('knowledge_consult', () => {
  let receipt: KnowledgeReceipt;
  let pkg: ContextPackage;
  it('returns the gate-cleared package and a receipt that names exactly the delivered cards', async () => {
    const res = await consult('scripted');
    expectContract('knowledge_consult', res, 200);
    ({ receipt, package: pkg } = res.json());
    expect(receipt).toMatchObject({
      kind: 'knowledge',
      agent: 'agent:scripted',
      target: 'local_model',
      taskRef: 'task:one',
      worldId: f.worldId,
      result: 'cards',
      packageId: pkg.id,
    });
    expect(receipt.cardIds.sort()).toEqual(pkg.items.map((i) => i.card.id).sort());
    expect(receipt.cardIds).not.toContain(f.ids.evPrivate);
    expect(res.body).not.toContain(PRIVATE_TEXT);
    expect(pkg.question).toBe(TASK_TEXT); // the package answers the task; the receipt does not
  });
  it('the receipt holds no content: not the task text, not a card title, not the private card', async () => {
    const text = JSON.stringify(receipt);
    expect(text).not.toContain('SECRET-TASK-WORDS');
    expect(text).not.toContain('Synthetic public claim');
    expect(receipt.queryHash).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    const onDisk = await readFile(logFile(), 'utf8');
    expect(onDisk).not.toContain('SECRET-TASK-WORDS');
    expect(onDisk).not.toContain('Synthetic public claim');
    expect(onDisk).not.toContain(PRIVATE_TEXT);
  });
  it('the same task text gives the same keyed hash, a different one does not; the key stays on the device', async () => {
    const again = (await consult('scripted')).json().receipt as KnowledgeReceipt;
    const other = (await consult('scripted', { task: 'another task' })).json()
      .receipt as KnowledgeReceipt;
    expect(again.queryHash).toBe(receipt.queryHash);
    expect(other.queryHash).not.toBe(receipt.queryHash);
    const keyFile = path.join(f.stateDir, 'receipt-key');
    expect((await readFile(keyFile)).length).toBe(32);
    if (process.platform !== 'win32') expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(logFile(), 'utf8')).not.toContain(
      (await readFile(keyFile)).toString('hex'),
    );
  });
  it('is appended to a hash chain that verifies, and the log is owner-only', async () => {
    const chain = checkChain(await logLines());
    expect(chain.ok).toBe(true);
    expect(chain.entries.map((e) => e.receipt.receiptId)).toContain(receipt.receiptId);
    if (process.platform !== 'win32') expect((await stat(logFile())).mode & 0o777).toBe(0o600);
  });
  it('a task record that cites the receipts passes the verifier; a forged one does not', async () => {
    const wb = (
      await f.agent('scripted', 'POST', '/knowledge/write-back', {
        taskRef: 'task:one',
        consultReceiptId: receipt.receiptId,
        notNeeded: { reason: 'no_new_knowledge' },
      })
    ).json().receipt as WriteBackReceipt;
    const now = Date.now();
    const record: TaskRecord = {
      taskRef: 'task:one',
      agent: 'agent:scripted',
      startedAt: new Date(now - 60_000).toISOString(),
      completedAt: new Date(now + 1000).toISOString(),
      knowledgeReceipt: { receiptId: receipt.receiptId, hash: receipt.hash },
      writeBackReceipt: { receiptId: wb.receiptId, hash: wb.hash },
    };
    expect(verifyReceipts([record], await logLines()).ok).toBe(true);
    const forged = {
      ...record,
      knowledgeReceipt: { receiptId: receipt.receiptId, hash: `sha256:${'a'.repeat(64)}` },
    };
    expect(verifyReceipts([forged], await logLines()).ok).toBe(false);
  });
  it('a failed consult leaves no receipt', async () => {
    const before = (await logLines()).length;
    const bad = await consult('scripted', { lageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
    expect(bad.statusCode).toBe(400);
    expect(await logLines()).toHaveLength(before);
  });
  it('a cloud_model connection: confirmation_required first, then cards after the human confirmed', async () => {
    const first = await consult('cloud-scripted', { taskRef: 'task:cloud' });
    expectContract('knowledge_consult', first, 200);
    const r1 = first.json().receipt as KnowledgeReceipt;
    expect(r1).toMatchObject({
      result: 'confirmation_required',
      target: 'cloud_model',
      cardIds: [],
    });
    expect(first.json().package.items).toEqual([]);
    const transferId = r1.transferId!;
    const transfer = (
      await f.human('GET', `/disclosure/transfers/${transferId}`)
    ).json() as DisclosureTransfer;
    expectContract(
      'disclosure_confirm',
      await f.human('POST', `/disclosure/transfers/${transferId}/confirm`, {
        payloadHash: transfer.payloadHash,
      }),
      200,
    );
    const second = await consult('cloud-scripted', { taskRef: 'task:cloud', transferId });
    expectContract('knowledge_consult', second, 200);
    const r2 = second.json().receipt as KnowledgeReceipt;
    expect(r2.result).toBe('cards');
    expect(r2.cardIds.sort()).toEqual([...transfer.cardIds].sort());
    expect(JSON.stringify(r2)).not.toContain('SECRET-TASK-WORDS');
    // a different connection cannot spend that transfer, and gets no receipt for trying
    const before = (await logLines()).length;
    expect((await consult('scripted', { transferId })).statusCode).toBe(400);
    expect(await logLines()).toHaveLength(before);
  });
  it('says nothing_found when the rules clear no card for the agent', async () => {
    const closed = await makeFixture({
      rules: 'rules:\n  - { id: screen-all, effect: allow, targets: [screen], match: {} }\n',
    });
    try {
      const res = await closed.agent('scripted', 'POST', '/knowledge/consult', {
        taskRef: 'task:empty',
        task: 'Anything.',
        worldId: closed.worldId,
      });
      expectContract('knowledge_consult', res, 200);
      expect(res.json().receipt).toMatchObject({ result: 'nothing_found', cardIds: [] });
    } finally {
      await closed.close();
    }
  });
});

describe('a broken receipt log', () => {
  it('refuses consults and write-backs (503) and shows no content, until a human repairs it', async () => {
    const own = await makeFixture();
    try {
      const ok = await own.agent('scripted', 'POST', '/knowledge/consult', {
        taskRef: 'task:x',
        task: 'x',
        worldId: own.worldId,
      });
      expect(ok.statusCode).toBe(200);
      const file = path.join(own.stateDir, 'receipt-log.jsonl');
      const lines = splitLogLines(await readFile(file, 'utf8'));
      await writeFile(file, `${lines[0]!.replace('"seq":0', '"seq":7')}\n`, { mode: 0o600 });
      // the open writer keeps working in this process only until restart; a fresh service refuses
      const { createService } = await import('./service.js');
      const second = await createService({
        storage: own.adapter,
        stateDir: own.stateDir,
        port: 4310,
      });
      try {
        const res = await second.app.inject({
          method: 'POST',
          url: '/knowledge/consult',
          headers: {
            host: '127.0.0.1:4310',
            authorization: `Bearer ${own.tokens['scripted']}`,
          },
          payload: { taskRef: 'task:y', task: 'y', worldId: own.worldId },
        } as never);
        expect(res.statusCode).toBe(503);
        expect(res.body).not.toContain('Synthetic public claim');
        const wb = await second.app.inject({
          method: 'POST',
          url: '/knowledge/write-back',
          headers: {
            host: '127.0.0.1:4310',
            authorization: `Bearer ${own.tokens['scripted']}`,
          },
          payload: { taskRef: 'task:y', notNeeded: { reason: 'no_new_knowledge' } },
        } as never);
        expect(wb.statusCode).toBe(503);
        const metrics = await second.app.inject({
          method: 'GET',
          url: '/metrics/usage',
          headers: { host: '127.0.0.1:4310', 'x-worldbuilder-session': second.sessionToken },
        } as never);
        expect(metrics.statusCode).toBe(503);
      } finally {
        await second.app.close();
      }
    } finally {
      await own.close();
    }
  });
});

describe('knowledge_write_back', () => {
  it('proposes a card: a pending proposal, a receipt with the draft hash, and no card yet', async () => {
    const card = draft('Written back claim');
    const res = await f.agent('scripted', 'POST', '/knowledge/write-back', {
      taskRef: 'task:wb',
      card,
      rationale: 'learned in the task',
    });
    expectContract('knowledge_write_back', res, 201);
    const { receipt, proposal } = res.json() as { receipt: WriteBackReceipt; proposal: Proposal };
    expect(proposal).toMatchObject({
      status: 'pending',
      kind: 'create_card',
      author: 'agent:scripted',
    });
    expect(receipt).toMatchObject({
      result: 'proposed',
      proposalId: proposal.id,
      draftHash: computeContentHash(card as never),
    });
    expect(
      (await f.adapter.list({ limit: 500 })).items.some((c) => c.title === 'Written back claim'),
    ).toBe(false);
    expect((await logLines()).join('\n')).toContain(receipt.receiptId);
    // the human accepts: the card is authored by the agent and private
    expectContract(
      'proposal_accept',
      await f.human('POST', `/proposals/${proposal.id}/accept`, {}),
      200,
    );
    const created = (await f.adapter.list({ limit: 500 })).items.find(
      (c) => c.title === 'Written back claim',
    ) as Card;
    expect(created.author).toBe('agent:scripted');
    expect(created.release ?? 'private').toBe('private');
  });
  it('refuses a card an agent may not write (human edge, training, worlds) and leaves no receipt', async () => {
    const before = (await logLines()).length;
    for (const extra of [
      { edges: [{ target: f.ids.evPublic, kind: 'supports', by: 'human' }] },
      { training: true },
      { release: 'community' },
      { worlds: [f.worldId] },
      { visibility: 'public' },
    ]) {
      const res = await f.agent('scripted', 'POST', '/knowledge/write-back', {
        taskRef: 'task:wb2',
        card: draft('Refused', extra),
      });
      expect(res.statusCode).toBe(400);
    }
    expect(await logLines()).toHaveLength(before);
  });
  it('already_covered must name cards the agent may know; unknown and hidden look alike', async () => {
    const post = (coveredBy: string[]) =>
      f.agent('scripted', 'POST', '/knowledge/write-back', {
        taskRef: 'task:cov',
        notNeeded: { reason: 'already_covered', coveredBy },
      });
    const good = await post([f.ids.evPublic]);
    expectContract('knowledge_write_back', good, 201);
    expect(good.json().receipt.coveredBy).toEqual([f.ids.evPublic]);
    const hidden = await post([f.ids.evPrivate]);
    const missing = await post(['01ARZ3NDEKTSV4RRFFQ69G5FAV']);
    expect(hidden.statusCode).toBe(400);
    expect(missing.statusCode).toBe(400);
    expect(hidden.body.replace(f.ids.evPrivate, 'X')).toBe(
      missing.body.replace('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'X'),
    );
  });
});

describe('decision_record and decision_outcome', () => {
  it('a recorded decision is a pending proposal; accepting creates a private card by the agent', async () => {
    const decision = {
      format: 2,
      type: 'decision',
      title: 'Agent decision',
      sections: sections([f.ids.evPublic]),
    };
    const res = await f.agent('scripted', 'POST', '/proposals/decision', {
      decision,
      lageId: f.ids.lage,
      x: 3,
      y: 4,
    });
    expectContract('decision_record', res, 201);
    const proposal = res.json() as Proposal;
    expect(
      (await f.adapter.list({ limit: 500 })).items.some((c) => c.title === 'Agent decision'),
    ).toBe(false);
    expectContract(
      'proposal_accept',
      await f.human('POST', `/proposals/${proposal.id}/accept`, {}),
      200,
    );
    const card = (await f.adapter.list({ limit: 500 })).items.find(
      (c) => c.title === 'Agent decision',
    ) as Card;
    expect(card).toMatchObject({ type: 'decision', author: 'agent:scripted' });
    expect(card.training).toBe(false);
    expect(card.release ?? 'private').toBe('private');
    expect(card.worlds).toEqual([f.worldId]);
  });
  it('cardsUsed must be cards the agent may know; a hidden one looks like a missing one', async () => {
    const post = (id: string) =>
      f.agent('scripted', 'POST', '/proposals/decision', {
        decision: { format: 2, type: 'decision', title: 'D', sections: sections([id]) },
      });
    const hidden = await post(f.ids.evPrivate);
    const missing = await post('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect([hidden.statusCode, missing.statusCode]).toEqual([400, 400]);
    expect(hidden.body.replace(f.ids.evPrivate, 'X')).toBe(
      missing.body.replace('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'X'),
    );
  });

  describe('record_outcome', () => {
    let decision: Card;
    const outcome = (hash: string, text = 'It worked out.') =>
      f.agent('scripted', 'POST', '/proposals/outcome', {
        decisionId: decision.id,
        outcome: text,
        expectedContentHash: hash,
      });
    beforeAll(async () => {
      const made = await f.human('POST', '/decisions', {
        format: 2,
        type: 'decision',
        title: 'Decision with an outcome to come',
        sections: sections([f.ids.evPublic]),
      });
      await f.adapter.patch(cardOf(made).id, { visibility: 'public' });
      decision = (await f.adapter.read(cardOf(made).id))!;
    });
    it('does nothing before the human accepts; accepting patches only sections.outcome', async () => {
      const res = await outcome(decision.contentHash);
      expectContract('decision_outcome', res, 201);
      expect((await f.adapter.read(decision.id))!.sections?.outcome).toBe('open');
      const accepted = await f.human('POST', `/proposals/${res.json().id}/accept`, {});
      expectContract('proposal_accept', accepted, 200);
      const after = (await f.adapter.read(decision.id))!;
      expect(after.sections).toEqual({ ...decision.sections, outcome: 'It worked out.' });
      expect(after.visibility).toBe('public');
      expect(after.release).toBe(decision.release);
      expect(after.training).toBe(decision.training);
      expect(after.title).toBe(decision.title);
      expect(after.author).toBe(decision.author);
      expect(after.contentHash).not.toBe(decision.contentHash);
    });
    it('a stale content hash is a 409 and the proposal stays pending, the card untouched', async () => {
      // `decision` was read before the outcome was recorded: its hash is stale now.
      const res = await outcome(decision.contentHash, 'A second opinion.');
      expectContract('decision_outcome', res, 201);
      const accepted = await f.human('POST', `/proposals/${res.json().id}/accept`, {});
      expectContract('proposal_accept', accepted, 409);
      expect((await f.adapter.read(decision.id))!.sections?.outcome).toBe('It worked out.');
      const pending = await f.human('GET', '/proposals?status=pending&limit=200');
      expect(pending.json().proposals.map((p: Proposal) => p.id)).toContain(res.json().id);
    });
    it('a decision the agent cannot see is a 404, like an unknown one', async () => {
      const priv = await f.human('POST', '/decisions', {
        format: 2,
        type: 'decision',
        title: 'Private decision',
        sections: sections([f.ids.evPublic]),
      });
      const res = await f.agent('scripted', 'POST', '/proposals/outcome', {
        decisionId: cardOf(priv).id,
        outcome: 'x',
        expectedContentHash: cardOf(priv).contentHash,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

describe('memory_route', () => {
  const route = async (text: string, kindHint?: string) =>
    (
      await f.agent('scripted', 'POST', '/memory/route', {
        text,
        ...(kindHint ? { kindHint } : {}),
      })
    ).json();
  it('routes durable knowledge to a card proposal and operational facts and secrets away', async () => {
    expect(
      await route('The corridor is consistently closed in winter because of ice.'),
    ).toMatchObject({
      route: 'card_proposal',
      ruleId: 'durable_statement',
    });
    expect(await route('Restarted the worker twice today after a timeout.')).toMatchObject({
      route: 'ephemeral_ops_fact',
      ruleId: 'transient',
    });
    const secret = await route(
      'The api key: sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 is for learning',
      'learning',
    );
    expect(secret).toMatchObject({ route: 'ephemeral_ops_fact', ruleId: 'secret' });
  });
  it('stores and logs nothing and never echoes the text', async () => {
    const before = await readFile(logFile(), 'utf8');
    const proposals = (await f.human('GET', '/proposals?limit=200')).json().proposals.length;
    const res = await f.agent('scripted', 'POST', '/memory/route', {
      text: 'UNIQUE-MEMORY-WORDS are always important because of the pattern.',
    });
    expect(res.body).not.toContain('UNIQUE-MEMORY-WORDS');
    expect(await readFile(logFile(), 'utf8')).toBe(before);
    expect((await f.human('GET', '/proposals?limit=200')).json().proposals).toHaveLength(proposals);
  });
});

describe('usage_metrics_get', () => {
  it('counts consults, write-backs and proposals per agent from the files', async () => {
    const res = await f.human('GET', '/metrics/usage');
    expectContract('usage_metrics_get', res, 200);
    const m = res.json() as UsageMetrics;
    const scripted = m.agents.find((a) => a.agent === 'agent:scripted')!;
    expect(scripted.consults).toBeGreaterThanOrEqual(3);
    expect(scripted.writeBacks).toBeGreaterThanOrEqual(3);
    expect(scripted.cardsProposed).toBeGreaterThanOrEqual(2);
    expect(scripted.cardsAccepted).toBeGreaterThanOrEqual(2);
    expect(scripted.outcomesProposed).toBeGreaterThanOrEqual(2);
    expect(m.decisions?.total).toBeGreaterThanOrEqual(2);
    expect(m.decisions?.withOutcome).toBeGreaterThanOrEqual(1);
    // no task records exist and no atlas was measured: those targets are not met
    const target = (id: string) => m.targets.find((t) => t.id === id)!;
    expect(target('receipt_coverage_7d')).toMatchObject({ value: null, met: false });
    expect(target('atlas_lag_hours')).toMatchObject({ value: null, met: false });
    expect(JSON.stringify(m)).not.toContain('SECRET-TASK-WORDS');
  });
});
