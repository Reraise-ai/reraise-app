// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileReceiptLogPort, loadOrCreateReceiptKey } from './fs-port.js';
import { GENESIS, ReceiptLog, buildEntry, checkChain, formatEntry, splitLogLines } from './log.js';
import { selfHash } from './receipts.js';
import { consult, logOf, memoryPort, writeBack } from './test-helpers.js';

type Entry = Record<string, unknown> & { receipt: Record<string, unknown> };

const receipts = [consult(1), writeBack(2), consult(3), writeBack(4)];

/** Rewrite line `i` with `edit`, optionally resealing the receipt and the entry hashes. */
function rewrite(
  lines: string[],
  i: number,
  edit: (e: Entry) => void,
  reseal: { receipt?: boolean; entry?: boolean } = {},
) {
  const e = JSON.parse(lines[i]!) as Entry;
  edit(e);
  if (reseal.receipt) e.receipt.hash = selfHash(e.receipt);
  if (reseal.entry) e.hash = selfHash(e);
  const out = [...lines];
  out[i] = JSON.stringify(e);
  return out;
}

describe('receipt log chain (ADR-0040)', () => {
  it('accepts an intact chain and an empty log', () => {
    const lines = logOf(receipts);
    const check = checkChain(lines);
    expect(check).toMatchObject({ ok: true, problems: [] });
    expect(check.entries.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(check.entries[0]!.prev).toBe(GENESIS);
    expect(check.head).toBe(check.entries[3]!.hash);
    expect(checkChain([])).toMatchObject({ ok: true, head: GENESIS });
  });

  it.each([
    [
      'an edited receipt',
      (l: string[]) => rewrite(l, 1, (e) => (e.receipt.taskRef = 'TASK-9')),
      'entry_hash',
    ],
    [
      'an edited receipt with a resealed receipt hash',
      (l: string[]) => rewrite(l, 1, (e) => (e.receipt.taskRef = 'TASK-9'), { receipt: true }),
      'entry_hash',
    ],
    [
      'a receipt edited behind a resealed entry',
      (l: string[]) => rewrite(l, 1, (e) => (e.receipt.taskRef = 'TASK-9'), { entry: true }),
      'receipt_hash',
    ],
    [
      'a fully resealed middle entry',
      (l: string[]) =>
        rewrite(l, 1, (e) => (e.receipt.taskRef = 'TASK-9'), { receipt: true, entry: true }),
      'prev_mismatch',
    ],
    ['a deleted entry', (l: string[]) => l.filter((_, i) => i !== 1), 'seq_gap'],
    ['reordered entries', (l: string[]) => [l[0]!, l[2]!, l[1]!, l[3]!], 'seq_gap'],
    [
      'a truncated last line',
      (l: string[]) => [...l.slice(0, 3), l[3]!.slice(0, 40)],
      'unparsable',
    ],
    [
      'an entry carrying content',
      (l: string[]) => rewrite(l, 0, (e) => (e.receipt.task = 'free text'), { entry: true }),
      'invalid_entry',
    ],
  ])('detects %s', (_name, tamper, code) => {
    const check = checkChain(tamper(logOf(receipts)));
    expect(check.ok).toBe(false);
    expect(check.problems[0]!.code).toBe(code);
  });

  it('detects a duplicate receipt id', () => {
    const r = consult(1);
    const first = buildEntry(undefined, r, r.at);
    const second = buildEntry(first, r, r.at);
    expect(checkChain([formatEntry(first), formatEntry(second)]).problems[0]!.code).toBe(
      'duplicate_receipt',
    );
  });

  it('cannot see a consistent rewrite of the last entry, unless the head was pinned', () => {
    const lines = logOf(receipts);
    const head = checkChain(lines).head;
    const tampered = rewrite(lines, 3, (e) => (e.receipt.reason = 'task_abandoned'), {
      receipt: true,
      entry: true,
    });
    expect(checkChain(tampered).ok).toBe(true);
    expect(checkChain(tampered, { expectedHead: head }).problems[0]!.code).toBe('head_mismatch');
    expect(checkChain(lines, { expectedHead: head }).ok).toBe(true);
  });

  it('splits files with and without a final line break', () => {
    expect(splitLogLines('')).toEqual([]);
    expect(splitLogLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLogLines('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('ReceiptLog writer (ADR-0040)', () => {
  it('appends a chain that verifies, also under concurrent appends', async () => {
    const port = memoryPort();
    const log = await ReceiptLog.open(port, () => new Date('2026-10-05T10:00:00Z'));
    expect(log.head).toBe(GENESIS);
    await Promise.all(receipts.map((r) => log.append(r)));
    const check = checkChain(port.lines);
    expect(check.ok).toBe(true);
    expect(check.entries.map((e) => e.receipt.receiptId)).toEqual(receipts.map((r) => r.receiptId));
    expect(log.head).toBe(check.head);

    const reopened = await ReceiptLog.open(port);
    await reopened.append(consult(5));
    expect(checkChain(port.lines).entries).toHaveLength(5);
  });

  it('refuses to open a broken log', async () => {
    const port = memoryPort(logOf(receipts).filter((_, i) => i !== 0));
    await expect(ReceiptLog.open(port)).rejects.toThrow(/broken/);
  });

  it('refuses a receipt whose hash does not match and keeps going afterwards', async () => {
    const port = memoryPort();
    const log = await ReceiptLog.open(port);
    await expect(log.append({ ...consult(1), taskRef: 'TASK-9' })).rejects.toThrow(/hash/);
    await expect(log.append({ ...consult(1), task: 'x' } as never)).rejects.toThrow(/invalid/);
    await log.append(consult(2));
    await expect(log.append(consult(2))).rejects.toThrow(/already in the log/);
    await expect((await ReceiptLog.open(port)).append(consult(2))).rejects.toThrow(/already/);
    expect(checkChain(port.lines)).toMatchObject({ ok: true });
    expect(port.lines).toHaveLength(1);
  });
});

describe('file port (ADR-0040)', () => {
  it('appends JSON lines to a file it creates, and reads a missing file as empty', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-log-'));
    try {
      const file = path.join(dir, 'state', 'receipt-log.jsonl');
      const port = fileReceiptLogPort(file);
      expect(await port.readLines()).toEqual([]);
      const log = await ReceiptLog.open(port);
      await log.append(consult(1));
      await log.append(writeBack(2));
      expect((await readFile(file, 'utf8')).split('\n')).toHaveLength(3);
      expect(checkChain(await port.readLines())).toMatchObject({ ok: true });
      await expect(port.appendLine('a\nb')).rejects.toThrow(/line break/);
      await expect(fileReceiptLogPort(dir).readLines()).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('device receipt key (ADR-0039)', () => {
  it('is created once, owner-only, and read back unchanged', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-key-'));
    try {
      const state = path.join(dir, 'state');
      const [a, b] = await Promise.all([
        loadOrCreateReceiptKey(state),
        loadOrCreateReceiptKey(state),
      ]);
      expect(a).toHaveLength(32);
      expect(b).toEqual(a);
      expect(await loadOrCreateReceiptKey(state)).toEqual(a);
      await writeFile(path.join(state, 'receipt-key'), 'short');
      await expect(loadOrCreateReceiptKey(state)).rejects.toThrow(/shorter/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
