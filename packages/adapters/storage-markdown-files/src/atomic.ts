// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Errors a rename can raise on Windows while a scanner, indexer or editor holds the file. */
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Rename, retrying briefly on the transient errors above. */
export async function renameWithRetry(
  from: string,
  to: string,
  doRename: (a: string, b: string) => Promise<void> = rename,
  attempts = 8,
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await doRename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (i >= attempts || !RETRYABLE.has(code)) throw err;
      await new Promise((r) => setTimeout(r, 10 * i));
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
export async function writeAtomic(file: string, text: string): Promise<void> {
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
    await renameWithRetry(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await syncDirectory(dir);
}
