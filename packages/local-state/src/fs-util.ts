// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// File helpers: atomic writes (temp file in the same directory, fsync, rename), a rename that
// survives the transient sharing violations Windows reports, and an in-process mutex.

import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export interface FsOps {
  rename(from: string, to: string): Promise<void>;
  /** Delay between rename retries; replaced in tests. */
  sleep(ms: number): Promise<void>;
  /** Uniform random in [0, 1) for retry jitter; replaced in tests. */
  random?(): number;
}

export const defaultFsOps: FsOps = {
  rename,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);
/**
 * Bounded retry budget: 12 attempts with exponential back-off (10, 20, 40, 80, 160, then 320 ms
 * per wait, i.e. 2.23 s of nominal waiting) and "equal jitter" (each wait is between half and the
 * full nominal value), so contending writers do not retry in lock step. A rename still failing
 * after that is reported as the original error and the temp file is removed (fail-closed: the
 * old content stays, nothing is half-written).
 */
const RENAME_ATTEMPTS = 12;
const MAX_WAIT_MS = 320;

/**
 * Rename, retrying on EPERM, EACCES and EBUSY. On Windows a rename onto a file that another
 * process (antivirus, search indexer, backup agent) holds open without delete sharing fails with
 * these codes until the handle is released; the condition is transient but can last a second or
 * more on a busy CI host.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  ops: FsOps = defaultFsOps,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ops.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_ATTEMPTS || code === undefined || !TRANSIENT.has(code)) throw e;
      const nominal = Math.min(10 * 2 ** (attempt - 1), MAX_WAIT_MS);
      const jitter = (ops.random ?? Math.random)();
      await ops.sleep(Math.round(nominal / 2 + (nominal / 2) * jitter));
    }
  }
}

/**
 * Write `data` so that readers see the old or the new content, never a partial file. The temp
 * file name starts with a dot and ends in `.tmp`, so listings of the real files never see it.
 */
export async function atomicWriteFile(
  file: string,
  data: string,
  ops: FsOps = defaultFsOps,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } catch (e) {
    await handle.close();
    await rm(tmp, { force: true });
    throw e;
  }
  await handle.close();
  try {
    await renameWithRetry(tmp, file, ops);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Runs tasks one after another; a failing task does not block the next. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
