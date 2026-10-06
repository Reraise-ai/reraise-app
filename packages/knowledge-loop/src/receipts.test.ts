// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { computeContentHash, hashJcs } from '@worldbuilder/core';
import type { CardDraft } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeReceipt,
  createWriteBackReceipt,
  hmacSha256,
  queryHash,
  receiptHashMatches,
  selfHash,
} from './receipts.js';
import { AGENT, KEY, WORLD, ulid } from './test-helpers.js';
import { validateContract } from './validate.js';

const MARKER = 'MARKER-private-task-text-7f3a';
const base = {
  receiptId: ulid(1),
  agent: AGENT,
  target: 'local_model' as const,
  taskRef: 'TASK-1',
  task: `Plan the reroute ${MARKER}`,
  queryKey: KEY,
  worldId: WORLD,
  at: '2026-10-05T09:00:00.000Z',
};

describe('Knowledge Receipt (ADR-0039)', () => {
  it('lists exactly the delivered cards, hashes the task and never stores it', () => {
    const r = createKnowledgeReceipt({
      ...base,
      package: {
        id: ulid(2),
        items: [{ card: { id: ulid(3) } }, { card: { id: ulid(4) } }] as never,
      },
    });
    expect(r.result).toBe('cards');
    expect(r.cardIds).toEqual([ulid(3), ulid(4)]);
    expect(r.queryHash).toBe(queryHash(base.task, KEY));
    expect(r.queryHash).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(r.queryHash.slice(12)).not.toBe(hashJcs(base.task).slice(7));
    expect(queryHash(base.task, new Uint8Array(32).fill(8))).not.toBe(r.queryHash);
    expect(JSON.stringify(r)).not.toContain(MARKER);
    expect(r.hash).toBe(selfHash(r));
    expect(receiptHashMatches(r)).toBe(true);
    expect(validateContract('knowledge-receipt.schema.json', r)).toEqual({ ok: true });
  });

  it('records nothing_found with no card ids', () => {
    const r = createKnowledgeReceipt({
      ...base,
      lageId: ulid(9),
      package: { id: ulid(2), items: [] },
    });
    expect(r).toMatchObject({ result: 'nothing_found', cardIds: [], lageId: ulid(9) });
  });

  it('records confirmation_required with the transfer for a cloud connection', () => {
    const r = createKnowledgeReceipt({
      ...base,
      target: 'cloud_model',
      package: { id: ulid(2), items: [], confirmationRequired: { transferId: ulid(7) } },
    });
    expect(r).toMatchObject({ result: 'confirmation_required', transferId: ulid(7), cardIds: [] });
  });

  it('names the released transfer of a confirmed cloud consult', () => {
    const r = createKnowledgeReceipt({
      ...base,
      target: 'cloud_model',
      package: {
        id: ulid(2),
        items: [{ card: { id: ulid(3) } }] as never,
        transfer: { transferId: ulid(8) } as never,
      },
    });
    expect(r).toMatchObject({ result: 'cards', transferId: ulid(8) });
  });

  it('refuses what the contract forbids: a local connection waiting for a cloud confirmation', () => {
    expect(() =>
      createKnowledgeReceipt({
        ...base,
        package: { id: ulid(2), items: [], confirmationRequired: { transferId: ulid(7) } },
      }),
    ).toThrow(/knowledge-receipt/);
  });

  it('refuses a task reference that could carry prose', () => {
    expect(() =>
      createKnowledgeReceipt({
        ...base,
        taskRef: 'fix the thing',
        package: { id: ulid(2), items: [] },
      }),
    ).toThrow(/taskRef/);
  });

  it('detects a changed receipt', () => {
    const r = createKnowledgeReceipt({ ...base, package: { id: ulid(2), items: [] } });
    expect(receiptHashMatches({ ...r, taskRef: 'TASK-2' })).toBe(false);
  });
});

describe('Write-back Receipt (ADR-0039)', () => {
  const draft: CardDraft = {
    format: 2,
    type: 'claim',
    title: 'Synthetic insurers raise premiums after transit restrictions',
    layer: 'said',
    source: 'https://news.example.org/a',
    release: 'private',
  };

  it('binds a proposed card by proposal id and draft content hash', () => {
    const r = createWriteBackReceipt({
      receiptId: ulid(11),
      agent: AGENT,
      taskRef: 'TASK-1',
      consultReceiptId: ulid(1),
      proposalId: ulid(12),
      draft,
      at: base.at,
    });
    expect(r).toMatchObject({
      result: 'proposed',
      proposalId: ulid(12),
      draftHash: computeContentHash(draft),
      consultReceiptId: ulid(1),
    });
    expect(JSON.stringify(r)).not.toContain('premiums');
    expect(receiptHashMatches(r)).toBe(true);
  });

  it('records a coded "not needed", with covering cards for already_covered', () => {
    const r = createWriteBackReceipt({
      receiptId: ulid(11),
      agent: AGENT,
      taskRef: 'TASK-1',
      notNeeded: { reason: 'already_covered', coveredBy: [ulid(3)] },
      at: base.at,
    });
    expect(r).toMatchObject({
      result: 'not_needed',
      reason: 'already_covered',
      coveredBy: [ulid(3)],
    });
    expect(r).not.toHaveProperty('proposalId');
  });

  it('refuses already_covered without covering cards', () => {
    expect(() =>
      createWriteBackReceipt({
        receiptId: ulid(11),
        agent: AGENT,
        taskRef: 'TASK-1',
        notNeeded: { reason: 'already_covered' },
        at: base.at,
      }),
    ).toThrow(/write-back/);
  });
});

describe('keyed query hash (ADR-0039)', () => {
  it('is HMAC-SHA256 (RFC 4231 test case 2 and a long key)', () => {
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(hex(hmacSha256(enc('Jefe'), enc('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    // RFC 4231 test case 6: a 131-byte key is hashed first.
    expect(
      hex(
        hmacSha256(
          new Uint8Array(131).fill(0xaa),
          enc('Test Using Larger Than Block-Size Key - Hash Key First'),
        ),
      ),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('refuses a short key', () => {
    expect(() => queryHash('x', new Uint8Array(16))).toThrow(/at least 32/);
  });
});
