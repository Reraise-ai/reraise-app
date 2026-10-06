// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { checkChain } from './log.js';
import {
  AGENT,
  OTHER_AGENT,
  consult,
  iso,
  logOf,
  taskOf,
  ulid,
  writeBack,
} from './test-helpers.js';
import { verifyAgainstChain, verifyReceipts } from './verify.js';

const k = consult(1, { taskRef: 'TASK-A', at: iso(5) });
const w = writeBack(2, { taskRef: 'TASK-A', at: iso(50), consultReceiptId: k.receiptId });
const k2 = consult(3, { taskRef: 'TASK-B', at: iso(10) });
const w2 = writeBack(4, { taskRef: 'TASK-B', at: iso(20) });
const other = consult(5, { taskRef: 'TASK-A', agent: OTHER_AGENT, at: iso(5) });
const lines = logOf([k, w, k2, w2, other]);

const codes = (report: ReturnType<typeof verifyReceipts>) =>
  report.tasks.map((t) => t.problems.map((p) => `${p.slot}:${p.code}`));

describe('verifyReceipts (ADR-0040)', () => {
  it('accepts task records whose receipts are in the log', () => {
    const report = verifyReceipts(
      [taskOf('TASK-A', k, w, { startedAt: iso(0) }), taskOf('TASK-B', k2, w2)],
      lines,
    );
    expect(report.ok).toBe(true);
    expect(codes(report)).toEqual([[], []]);
  });

  it('fails every task when the chain is broken', () => {
    const report = verifyReceipts([taskOf('TASK-A', k, w)], [lines[1]!, lines[0]!]);
    expect(report.ok).toBe(false);
    expect(codes(report)).toEqual([['knowledge:chain_broken', 'write_back:chain_broken']]);
  });

  it.each([
    ['missing', taskOf('TASK-A', undefined, w), ['knowledge:missing', 'write_back:unlinked']],
    ['a missing write-back', taskOf('TASK-A', k, undefined), ['write_back:missing']],
    [
      'unknown',
      { ...taskOf('TASK-A', k, w), knowledgeReceipt: { receiptId: ulid(99), hash: k.hash } },
      ['knowledge:unknown', 'write_back:unlinked'],
    ],
    [
      'forged',
      { ...taskOf('TASK-A', k, w), knowledgeReceipt: { receiptId: k.receiptId, hash: w.hash } },
      ['knowledge:forged'],
    ],
    [
      'wrong_kind',
      taskOf('TASK-A', k, undefined, {
        writeBackReceipt: { receiptId: k.receiptId, hash: k.hash },
      }),
      ['write_back:wrong_kind'],
    ],
    ['wrong_agent', taskOf('TASK-B', other, w2), ['knowledge:wrong_agent']],
    ['wrong_task', taskOf('TASK-A', k2, w), ['knowledge:wrong_task', 'write_back:unlinked']],
    [
      'stale (before startedAt)',
      taskOf('TASK-A', k, w, { startedAt: iso(30) }),
      ['knowledge:stale'],
    ],
    [
      'stale (older than the maximum age)',
      taskOf('TASK-A', k, w, { completedAt: iso(60 * 30) }),
      ['knowledge:stale', 'write_back:stale'],
    ],
    [
      'out_of_window (after completion)',
      taskOf('TASK-A', k, w, { completedAt: iso(30) }),
      ['write_back:out_of_window'],
    ],
  ])('reports %s', (_name, task, expected) => {
    const report = verifyReceipts([task], lines);
    expect(report.ok).toBe(false);
    expect(codes(report)[0]).toEqual(expected);
  });

  it('reports a write-back that is earlier than the consult', () => {
    const early = writeBack(6, { taskRef: 'TASK-C', at: iso(1) });
    const late = consult(7, { taskRef: 'TASK-C', at: iso(40) });
    const report = verifyReceipts([taskOf('TASK-C', late, early)], logOf([early, late]));
    expect(codes(report)[0]).toEqual(['write_back:out_of_window']);
  });

  it('reports a receipt cited by a second task record as reused', () => {
    const report = verifyReceipts([taskOf('TASK-A', k, w), taskOf('TASK-A', k, w)], lines);
    expect(codes(report)).toEqual([[], ['knowledge:reused', 'write_back:reused']]);
  });

  it('honours the clock-skew tolerance and the maximum age option', () => {
    const task = taskOf('TASK-A', k, w, { completedAt: iso(48) });
    expect(codes(verifyReceipts([task], lines))[0]).toEqual([]);
    expect(codes(verifyReceipts([task], lines, { skewSeconds: 0 }))[0]).toEqual([
      'write_back:out_of_window',
    ]);
    const old = taskOf('TASK-A', k, w, { completedAt: iso(60 * 3) });
    expect(codes(verifyReceipts([old], lines, { maxAgeHours: 1 }))[0]).toEqual([
      'knowledge:stale',
      'write_back:stale',
    ]);
  });

  it('verifies against a chain checked once, with a pinned head', () => {
    const chain = checkChain(lines, { expectedHead: 'sha256:' + 'f'.repeat(64) });
    const report = verifyAgainstChain([taskOf('TASK-A', k, w)], chain);
    expect(report.ok).toBe(false);
    expect(report.tasks[0]!.agent).toBe(AGENT);
  });
});
