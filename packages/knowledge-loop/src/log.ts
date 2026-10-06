// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The receipt log (ADR-0040): `<state>/receipt-log.jsonl`, append-only and hash-chained. Each
// entry holds the hash of the previous one; its own `hash` is the JCS hash of the entry without
// `hash`. The chain check is pure; I/O goes through an injected port.

import type { ReceiptLogEntry } from '@worldbuilder/core';
import type { Receipt } from './receipts.js';
import { receiptHashMatches, selfHash } from './receipts.js';
import { validateContract } from './validate.js';

/** `prev` of the first entry. */
export const GENESIS = `sha256:${'0'.repeat(64)}`;

/** File name of the log inside the state directory. */
export const RECEIPT_LOG_FILE = 'receipt-log.jsonl';

/** I/O of the log: read every line, append one line. The service is the only writer. */
export interface ReceiptLogPort {
  /** All lines of the log, without line terminators; `[]` when the log does not exist. */
  readLines(): Promise<readonly string[]>;
  /** Append one line; the port adds the line terminator. */
  appendLine(line: string): Promise<void>;
}

export type ChainProblemCode =
  | 'unparsable'
  | 'invalid_entry'
  | 'seq_gap'
  | 'prev_mismatch'
  | 'entry_hash'
  | 'receipt_hash'
  | 'duplicate_receipt'
  | 'head_mismatch';

export interface ChainProblem {
  /** 1-based line number; 0 for a problem of the whole log (head mismatch). */
  readonly line: number;
  readonly code: ChainProblemCode;
  readonly message: string;
}

export interface ChainCheck {
  readonly ok: boolean;
  /** Entries up to (not including) the first broken line. */
  readonly entries: readonly ReceiptLogEntry[];
  /** Hash of the last good entry, or GENESIS for an empty log. */
  readonly head: string;
  readonly problems: readonly ChainProblem[];
}

export interface ChainCheckOptions {
  /** A head hash pinned earlier; a different head means the tail was rewritten. */
  readonly expectedHead?: string;
}

/** Split a log file into lines; a final line terminator does not make an empty line. */
export function splitLogLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Check the whole chain. Stops at the first broken line: everything after it is untrusted.
 * Fail closed: any problem makes `ok` false.
 */
export function checkChain(lines: readonly string[], options: ChainCheckOptions = {}): ChainCheck {
  const entries: ReceiptLogEntry[] = [];
  const ids = new Set<string>();
  let head = GENESIS;
  const fail = (line: number, code: ChainProblemCode, message: string): ChainCheck => ({
    ok: false,
    entries,
    head,
    problems: [{ line, code, message }],
  });
  for (const [i, text] of lines.entries()) {
    const line = i + 1;
    let entry: unknown;
    try {
      entry = JSON.parse(text);
    } catch {
      return fail(line, 'unparsable', `line ${line} is not JSON`);
    }
    const valid = validateContract('receipt-log-entry.schema.json', entry);
    if (!valid.ok) return fail(line, 'invalid_entry', `line ${line}: ${valid.message}`);
    const e = entry as ReceiptLogEntry;
    if (e.seq !== i) return fail(line, 'seq_gap', `line ${line} has seq ${e.seq}, expected ${i}`);
    if (e.prev !== head) {
      return fail(line, 'prev_mismatch', `line ${line} does not follow the previous entry`);
    }
    if (e.hash !== selfHash(e)) {
      return fail(line, 'entry_hash', `line ${line}: entry hash does not match its content`);
    }
    if (!receiptHashMatches(e.receipt as Receipt)) {
      return fail(line, 'receipt_hash', `line ${line}: receipt hash does not match its content`);
    }
    if (ids.has(e.receipt.receiptId)) {
      return fail(line, 'duplicate_receipt', `line ${line} repeats receipt ${e.receipt.receiptId}`);
    }
    ids.add(e.receipt.receiptId);
    entries.push(e);
    head = e.hash;
  }
  if (options.expectedHead !== undefined && options.expectedHead !== head) {
    return fail(0, 'head_mismatch', `log head is ${head}, expected ${options.expectedHead}`);
  }
  return { ok: true, entries, head, problems: [] };
}

/** The next entry after `previous` (undefined for the first), sealed with its hash. */
export function buildEntry(
  previous: Pick<ReceiptLogEntry, 'seq' | 'hash'> | undefined,
  receipt: Receipt,
  at: string,
): ReceiptLogEntry {
  const unsealed = {
    v: 1 as const,
    seq: previous === undefined ? 0 : previous.seq + 1,
    at,
    prev: previous === undefined ? GENESIS : previous.hash,
    receipt,
  };
  return { ...unsealed, hash: selfHash(unsealed) };
}

/** Serialise an entry as one JSON line (no terminator). */
export function formatEntry(entry: ReceiptLogEntry): string {
  return JSON.stringify(entry);
}

/**
 * The writer of the log. `open` verifies the whole chain and refuses a broken log; `append`
 * serialises writers in process and validates each entry before it is written.
 */
export class ReceiptLog {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly port: ReceiptLogPort,
    private last: ReceiptLogEntry | undefined,
    private readonly ids: Set<string>,
    private readonly now: () => Date,
  ) {}

  /** Open the log through `port`. Throws when the chain is broken (ADR-0040). */
  static async open(port: ReceiptLogPort, now: () => Date = () => new Date()): Promise<ReceiptLog> {
    const check = checkChain(await port.readLines());
    if (!check.ok) {
      throw new Error(`receipt log is broken, refusing to append: ${check.problems[0]?.message}`);
    }
    return new ReceiptLog(
      port,
      check.entries.at(-1),
      new Set(check.entries.map((e) => e.receipt.receiptId)),
      now,
    );
  }

  /** Hash of the last entry, or GENESIS. */
  get head(): string {
    return this.last?.hash ?? GENESIS;
  }

  /** Append one receipt; resolves with the written entry. */
  append(receipt: Receipt): Promise<ReceiptLogEntry> {
    const run = this.queue.then(async () => {
      const entry = buildEntry(this.last, receipt, this.now().toISOString());
      const valid = validateContract('receipt-log-entry.schema.json', entry);
      if (!valid.ok) throw new Error(`receipt log entry invalid: ${valid.message}`);
      if (!receiptHashMatches(receipt)) throw new Error('receipt hash does not match its content');
      if (this.ids.has(receipt.receiptId)) {
        throw new Error(`receipt ${receipt.receiptId} is already in the log`);
      }
      await this.port.appendLine(formatEntry(entry));
      this.last = entry;
      this.ids.add(receipt.receiptId);
      return entry;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
