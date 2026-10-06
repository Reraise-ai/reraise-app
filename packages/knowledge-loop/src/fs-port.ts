// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// File port of the receipt log (ADR-0040): the service and the wb command line use it; the
// log logic itself stays pure.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReceiptLogPort } from './log.js';
import { splitLogLines } from './log.js';

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
