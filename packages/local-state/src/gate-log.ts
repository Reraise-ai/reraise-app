// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Gate decision log (ADR-0030): append-only JSON Lines with card id, target, decision and
// reason, never card content. Rotated by size: `gate-log.jsonl` -> `.1` -> ... -> `.<keep>`.

import type { GateLogEntry } from '@worldbuilder/core';
import { appendFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { localStateError } from './errors.js';
import { Mutex, renameWithRetry } from './fs-util.js';
import { ULID_PATTERN } from './ulid.js';

export const DEFAULT_GATE_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_GATE_LOG_KEEP = 5;
const MAX_REASON = 200;
const TARGETS = new Set(['screen', 'local_model', 'cloud_model', 'demo']);

export interface GateLogOptions {
  readonly maxBytes?: number;
  readonly keep?: number;
  readonly now?: () => Date;
}

/** Serialise exactly the allowed fields; anything else on the object is dropped. */
export function formatGateLogLine(entry: GateLogEntry, at: string): string {
  if (!ULID_PATTERN.test(entry.cardId)) throw localStateError('invalid', 'gate log: bad card id');
  if (!TARGETS.has(entry.target)) throw localStateError('invalid', 'gate log: bad target');
  if (entry.decision !== 'allow' && entry.decision !== 'deny') {
    throw localStateError('invalid', 'gate log: bad decision');
  }
  if (entry.item !== 'card' && entry.item !== 'stance') {
    throw localStateError('invalid', 'gate log: bad item');
  }
  return `${JSON.stringify({
    at,
    cardId: entry.cardId,
    item: entry.item,
    target: entry.target,
    decision: entry.decision,
    reason: String(entry.reason).slice(0, MAX_REASON),
  })}\n`;
}

export class GateLog {
  private readonly mutex = new Mutex();
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly now: () => Date;

  constructor(
    private readonly file: string,
    options: GateLogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? DEFAULT_GATE_LOG_MAX_BYTES;
    this.keep = options.keep ?? DEFAULT_GATE_LOG_KEEP;
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1)
      throw new Error('maxBytes must be >= 1');
    if (!Number.isInteger(this.keep) || this.keep < 0) throw new Error('keep must be >= 0');
    this.now = options.now ?? (() => new Date());
  }

  append(entry: GateLogEntry): Promise<void> {
    const line = formatGateLogLine(entry, entry.at ?? this.now().toISOString());
    return this.mutex.run(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const size = await stat(this.file).then(
        (s) => s.size,
        () => 0,
      );
      if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) await this.rotate();
      await appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 });
    });
  }

  /** Drop the oldest, shift the others up, move the live file to `.1`. */
  private async rotate(): Promise<void> {
    const numbered = (n: number) => `${this.file}.${n}`;
    if (this.keep === 0) {
      await rm(this.file, { force: true });
      return;
    }
    await rm(numbered(this.keep), { force: true });
    for (let n = this.keep - 1; n >= 1; n--) {
      await renameWithRetry(numbered(n), numbered(n + 1)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
    await renameWithRetry(this.file, numbered(1));
  }
}
