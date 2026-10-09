// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Errors a rename can raise on Windows while a scanner, indexer, editor or reader holds the file. */
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Injectable seams (tests replace them). */
export interface RenameOps {
  rename(from: string, to: string): Promise<void>;
  /** Delay between attempts. */
  sleep(ms: number): Promise<void>;
  /** Uniform random in [0, 1) for retry jitter. */
  random?(): number;
}

const defaultOps: RenameOps = {
  rename,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** 12 attempts, waits min(10 * 2^(n-1), 320) ms with equal jitter (about 2.2 s nominal). */
const RENAME_ATTEMPTS = 12;
const MAX_WAIT_MS = 320;

/**
 * Rename, retrying on EPERM, EACCES and EBUSY. On Windows any open handle on the target,
 * including a concurrent reader in this process, blocks a replacing rename until it is closed.
 * Waits grow exponentially with "equal jitter" (between half and the full nominal value). After
 * the last attempt the original error is rethrown (fail-closed).
 *
 * Twin of `renameWithRetry` in `packages/local-state/src/fs-util.ts`; this package must not
 * depend on local-state, so the small function is duplicated. Keep both schedules in step.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  ops: RenameOps = defaultOps,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ops.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_ATTEMPTS || code === undefined || !RETRYABLE.has(code)) throw err;
      const nominal = Math.min(10 * 2 ** (attempt - 1), MAX_WAIT_MS);
      const jitter = (ops.random ?? Math.random)();
      await ops.sleep(Math.round(nominal / 2 + (nominal / 2) * jitter));
    }
  }
}

/** Flush a directory entry to disk; not supported everywhere, so failures are ignored. */
async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows cannot open a directory this way; the rename is still atomic there.
  }
}

/**
 * Write through a temporary file, flush it, rename it over the target and flush the folder:
 * a reader (or a crash) sees the old card or the new one, never half of one.
 */
export async function writeAtomic(
  file: string,
  text: string,
  ops: RenameOps = defaultOps,
): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, file, ops);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await syncDirectory(dir);
}
