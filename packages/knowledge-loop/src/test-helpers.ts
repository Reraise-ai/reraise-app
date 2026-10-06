// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Synthetic test data for the knowledge-loop tests. Not part of the build.

import type { KnowledgeReceipt, TaskRecord, WriteBackReceipt } from '@worldbuilder/core';
import type { ReceiptLogPort } from './log.js';
import { buildEntry, formatEntry } from './log.js';
import { createKnowledgeReceipt, createWriteBackReceipt } from './receipts.js';

/** A valid, readable ULID for test number `n` (digits are Crockford base32). */
export const ulid = (n: number, prefix = '01JA') => `${prefix}${String(n).padStart(22, '0')}`;

export const WORLD = ulid(900, '01JW');
/** Synthetic device receipt key for tests. */
export const KEY = new Uint8Array(32).fill(7);
export const AGENT = 'agent:scout';
export const OTHER_AGENT = 'agent:scribe';

/** In-memory receipt log port. */
export function memoryPort(lines: string[] = []): ReceiptLogPort & { lines: string[] } {
  return {
    lines,
    async readLines() {
      return [...lines];
    },
    async appendLine(line: string) {
      lines.push(line);
    },
  };
}

export const iso = (minutes: number) =>
  new Date(Date.UTC(2026, 9, 5, 9, 0) + minutes * 60_000).toISOString();

export function consult(
  n: number,
  opts: { taskRef?: string; agent?: string; at?: string; cards?: string[] } = {},
): KnowledgeReceipt {
  const cards = opts.cards ?? [ulid(100 + n)];
  return createKnowledgeReceipt({
    receiptId: ulid(n),
    agent: opts.agent ?? AGENT,
    target: 'local_model',
    taskRef: opts.taskRef ?? `TASK-${n}`,
    task: `Synthetic task ${n}: check the transit restrictions`,
    queryKey: KEY,
    worldId: WORLD,
    package: { id: ulid(500 + n), items: cards.map((id) => ({ card: { id } }) as never) },
    at: opts.at ?? iso(n),
  });
}

export function writeBack(
  n: number,
  opts: { taskRef?: string; agent?: string; at?: string; consultReceiptId?: string } = {},
): WriteBackReceipt {
  return createWriteBackReceipt({
    receiptId: ulid(n),
    agent: opts.agent ?? AGENT,
    taskRef: opts.taskRef ?? `TASK-${n}`,
    ...(opts.consultReceiptId !== undefined ? { consultReceiptId: opts.consultReceiptId } : {}),
    notNeeded: { reason: 'no_new_knowledge' },
    at: opts.at ?? iso(n),
  });
}

/** Log lines for the given receipts, chained in order. */
export function logOf(receipts: readonly (KnowledgeReceipt | WriteBackReceipt)[]): string[] {
  const lines: string[] = [];
  let prev: ReturnType<typeof buildEntry> | undefined;
  for (const r of receipts) {
    prev = buildEntry(prev, r, r.at);
    lines.push(formatEntry(prev));
  }
  return lines;
}

/** A task record citing the given receipts. */
export function taskOf(
  taskRef: string,
  k: KnowledgeReceipt | undefined,
  w: WriteBackReceipt | undefined,
  extra: Partial<TaskRecord> = {},
): TaskRecord {
  return {
    taskRef,
    agent: AGENT,
    completedAt: iso(60),
    ...(k ? { knowledgeReceipt: { receiptId: k.receiptId, hash: k.hash } } : {}),
    ...(w ? { writeBackReceipt: { receiptId: w.receiptId, hash: w.hash } } : {}),
    ...extra,
  };
}
