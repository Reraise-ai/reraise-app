// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// File port of the receipt log (ADR-0040): the service and the wb command line use it; the
// log logic itself stays pure.

import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReceiptLogPort } from './log.js';
import { splitLogLines } from './log.js';
import { RECEIPT_KEY_BYTES } from './receipts.js';

/** File name of the device receipt key inside the state directory (ADR-0039). */
export const RECEIPT_KEY_FILE = 'receipt-key';

/** A port over one JSON Lines file, created owner-only on first append. */
export function fileReceiptLogPort(file: string): ReceiptLogPort {
  return {
    async readLines() {
      try {
        return splitLogLines(await readFile(file, 'utf8'));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      }
    },
    async appendLine(line: string) {
      if (/[\r\n]/.test(line)) throw new Error('a receipt log line must not contain a line break');
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

/**
 * The device receipt key: 32 random bytes in `<state>/receipt-key`, created owner-only on first
 * use. The key is written completely to a temporary file and then hard-linked into place, which
 * fails with EEXIST if another start was faster: a reader never sees a half-written key, and two
 * starts cannot end up with different keys. It keys the query hash of Knowledge Receipts and
 * never leaves the device.
 */
export async function loadOrCreateReceiptKey(stateDir: string): Promise<Uint8Array> {
  const file = path.join(stateDir, RECEIPT_KEY_FILE);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, randomBytes(RECEIPT_KEY_BYTES), { flag: 'wx', mode: 0o600 });
    await link(tmp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
  const key = new Uint8Array(await readFile(file));
  if (key.length < RECEIPT_KEY_BYTES)
    throw new Error(`${file} is shorter than ${RECEIPT_KEY_BYTES} bytes`);
  return key;
}
