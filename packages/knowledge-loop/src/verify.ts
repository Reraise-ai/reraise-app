// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Receipt verifier (ADR-0040): checks the receipts that task records cite against the receipt
// log. Fail closed: a broken chain fails every task; per receipt the first failing check wins.

import type {
  KnowledgeReceipt,
  ReceiptLogEntry,
  ReceiptRef,
  TaskRecord,
  WriteBackReceipt,
} from '@worldbuilder/core';
import type { ChainCheck, ChainCheckOptions } from './log.js';
import { checkChain } from './log.js';

export type ReceiptSlot = 'knowledge' | 'write_back';

export type ReceiptProblemCode =
  | 'chain_broken'
  | 'missing'
  | 'unknown'
  | 'forged'
  | 'wrong_kind'
  | 'wrong_agent'
  | 'wrong_task'
  | 'unlinked'
  | 'stale'
  | 'out_of_window'
  | 'reused';

export interface ReceiptProblem {
  readonly slot: ReceiptSlot;
  readonly code: ReceiptProblemCode;
  readonly message: string;
}

export interface TaskVerification {
  readonly taskRef: string;
  readonly agent: string;
  readonly ok: boolean;
  readonly problems: readonly ReceiptProblem[];
}

export interface VerificationReport {
  /** True when the chain is intact and every task record is valid. */
  readonly ok: boolean;
  readonly chain: ChainCheck;
  readonly tasks: readonly TaskVerification[];
}

export interface VerifyOptions extends ChainCheckOptions {
  /** Without `startedAt`, how long before `completedAt` a consult may be (default 24). */
  readonly maxAgeHours?: number;
  /** Clock-skew tolerance for every time comparison (default 300). */
  readonly skewSeconds?: number;
}

export const DEFAULT_MAX_AGE_HOURS = 24;
export const DEFAULT_SKEW_SECONDS = 300;

const ms = (iso: string) => Date.parse(iso);

/**
 * Verify every task record against the log lines. `logLines` are the raw lines of
 * `<state>/receipt-log.jsonl`; the chain is checked first.
 */
export function verifyReceipts(
  tasks: readonly TaskRecord[],
  logLines: readonly string[],
  options: VerifyOptions = {},
): VerificationReport {
  const chain = checkChain(logLines, options);
  return verifyAgainstChain(tasks, chain, options);
}

/** Verify task records against an already checked chain. */
export function verifyAgainstChain(
  tasks: readonly TaskRecord[],
  chain: ChainCheck,
  options: VerifyOptions = {},
): VerificationReport {
  const maxAgeMs = (options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3_600_000;
  const skewMs = (options.skewSeconds ?? DEFAULT_SKEW_SECONDS) * 1000;
  const byId = new Map<string, ReceiptLogEntry['receipt']>(
    chain.entries.map((e) => [e.receipt.receiptId, e.receipt]),
  );
  const used = new Set<string>();

  const results = tasks.map((task): TaskVerification => {
    const problems: ReceiptProblem[] = [];
    if (!chain.ok) {
      for (const slot of ['knowledge', 'write_back'] as const) {
        problems.push({ slot, code: 'chain_broken', message: 'the receipt log is broken' });
      }
      return { taskRef: task.taskRef, agent: task.agent, ok: false, problems };
    }
    const completed = ms(task.completedAt);
    const windowStart = task.startedAt !== undefined ? ms(task.startedAt) : completed - maxAgeMs;

    const check = <K extends ReceiptSlot>(
      slot: K,
      ref: ReceiptRef | undefined,
    ): (K extends 'knowledge' ? KnowledgeReceipt : WriteBackReceipt) | undefined => {
      const problem = (code: ReceiptProblemCode, message: string) => {
        problems.push({ slot, code, message });
        return undefined;
      };
      const label = slot === 'knowledge' ? 'knowledge receipt' : 'write-back receipt';
      if (ref === undefined) return problem('missing', `no ${label} cited`);
      const receipt = byId.get(ref.receiptId);
      if (receipt === undefined) {
        return problem('unknown', `${label} ${ref.receiptId} is not in the receipt log`);
      }
      if (receipt.hash !== ref.hash) {
        return problem('forged', `${label} ${ref.receiptId}: cited hash differs from the log`);
      }
      if (receipt.kind !== slot) {
        return problem('wrong_kind', `${label} ${ref.receiptId} is a ${receipt.kind} receipt`);
      }
      if (receipt.agent !== task.agent) {
        return problem('wrong_agent', `${label} ${ref.receiptId} belongs to ${receipt.agent}`);
      }
      if (receipt.taskRef !== task.taskRef) {
        return problem('wrong_task', `${label} ${ref.receiptId} is for task ${receipt.taskRef}`);
      }
      const at = ms(receipt.at);
      if (at < windowStart - skewMs) {
        return problem('stale', `${label} ${ref.receiptId} is older than the task window`);
      }
      if (at > completed + skewMs) {
        return problem('out_of_window', `${label} ${ref.receiptId} is after task completion`);
      }
      if (used.has(ref.receiptId)) {
        return problem('reused', `${label} ${ref.receiptId} is already cited by another task`);
      }
      used.add(ref.receiptId);
      return receipt as K extends 'knowledge' ? KnowledgeReceipt : WriteBackReceipt;
    };

    const consult = check('knowledge', task.knowledgeReceipt);
    const writeBack = check('write_back', task.writeBackReceipt);
    if (writeBack !== undefined) {
      if (
        writeBack.consultReceiptId !== undefined &&
        writeBack.consultReceiptId !== task.knowledgeReceipt?.receiptId
      ) {
        problems.push({
          slot: 'write_back',
          code: 'unlinked',
          message: `write-back receipt names consult ${writeBack.consultReceiptId}, not the task's`,
        });
      } else if (consult !== undefined && ms(writeBack.at) < ms(consult.at) - skewMs) {
        problems.push({
          slot: 'write_back',
          code: 'out_of_window',
          message: 'write-back receipt is earlier than the consult',
        });
      }
    }
    return { taskRef: task.taskRef, agent: task.agent, ok: problems.length === 0, problems };
  });
  return { ok: chain.ok && results.every((r) => r.ok), chain, tasks: results };
}
