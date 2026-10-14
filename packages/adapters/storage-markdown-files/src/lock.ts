// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Single-writer safety (ADR-0006, ADR-0029): one lock file per store, held only for the
// short critical section of one write. Created with the exclusive flag, which is atomic on
// every supported platform and network share that honours O_EXCL.

import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { MarkdownStoreError } from './errors.js';

export interface LockOptions {
  /** How long to wait for another writer before giving up. Default 10 s. */
  readonly timeoutMs?: number;
  /** A lock older than this is considered abandoned. Default 60 s (a write takes milliseconds). */
  readonly staleMs?: number;
  /** Poll interval while waiting. Default 20 ms (plus jitter). */
  readonly pollMs?: number;
}

interface LockFileContent {
  readonly token: string;
  readonly pid: number;
  readonly host: string;
  readonly createdAt: number;
}

/** A held lock; release it exactly once. */
export interface HeldLock {
  /** True while the lock file still carries our token (a stale-lock breaker may have taken it). */
  stillHeld(): Promise<boolean>;
  release(): Promise<void>;
}

/** A hash of the host name: enough to tell hosts apart, never the name itself. */
export const hostId = (): string =>
  createHash('sha256').update(hostname()).digest('hex').slice(0, 16);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseLock(text: string): LockFileContent | undefined {
  try {
    const v = JSON.parse(text) as Partial<LockFileContent>;
    if (
      typeof v.token === 'string' &&
      typeof v.pid === 'number' &&
      typeof v.host === 'string' &&
      typeof v.createdAt === 'number'
    ) {
      return v as LockFileContent;
    }
  } catch {
    // fall through: unreadable content is treated as a lock of unknown age below
  }
  return undefined;
}

/** True if the lock was abandoned: too old, or held by a process that no longer exists here. */
export function isStale(lock: LockFileContent | undefined, staleMs: number, now: number): boolean {
  if (!lock) return false; // unreadable: a writer may be mid-creation, judged by age elsewhere
  if (now - lock.createdAt > staleMs) return true;
  return lock.host === hostId() && !pidAlive(lock.pid);
}

/** Acquire the store's write lock at `lockPath`, waiting up to `timeoutMs`. */
export async function acquireLock(lockPath: string, options: LockOptions = {}): Promise<HeldLock> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 60_000;
  const pollMs = options.pollMs ?? 20;
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  const content: LockFileContent = {
    token,
    pid: process.pid,
    host: hostId(),
    createdAt: Date.now(),
  };
  await mkdir(path.dirname(lockPath), { recursive: true });
  // The folder holds only machine-local state; a version control tool must never pick it up.
  await writeFile(path.join(path.dirname(lockPath), '.gitignore'), '*\n', { flag: 'wx' }).catch(
    () => undefined,
  );

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({ ...content, createdAt: Date.now() }));
      } finally {
        await handle.close();
      }
      return {
        stillHeld: async () =>
          parseLock(await readFile(lockPath, 'utf8').catch(() => ''))?.token === token,
        release: async () => {
          // Remove only our own lock: a stale-lock breaker may have replaced it.
          const current = parseLock(await readFile(lockPath, 'utf8').catch(() => ''));
          if (current?.token === token) await unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Windows reports EPERM when two exclusive creates race on the same lock file.
      if (code === 'EPERM') {
        const there = await stat(lockPath).then(
          () => true,
          () => false,
        );
        if (!there) throw err;
      } else if (code !== 'EEXIST') {
        throw err;
      }
    }
    await breakIfStale(lockPath, staleMs);
    if (Date.now() >= deadline) {
      throw new MarkdownStoreError(
        'locked',
        'another writer holds the store lock; try again in a moment',
      );
    }
    await sleep(pollMs + Math.floor(Math.random() * pollMs));
  }
}

/**
 * Move an abandoned lock out of the way. The move is atomic, so only one breaker wins. If the
 * bytes that were moved are not the bytes that were judged stale (a fresh lock took the slot
 * in between), the file is put back with a hard link, which never replaces a lock that has
 * been taken meanwhile. `afterRead` is a test seam for exactly that race.
 */
export async function breakIfStale(
  lockPath: string,
  staleMs: number,
  afterRead?: () => Promise<void>,
): Promise<void> {
  const text = await readFile(lockPath, 'utf8').catch(() => undefined);
  if (text === undefined) return; // released meanwhile
  const lock = parseLock(text);
  // An unreadable file is a writer mid-creation or a crashed one; only age tells them apart.
  const unreadableAndOld = lock === undefined && (await ageMs(lockPath)) > staleMs;
  if (!unreadableAndOld && !isStale(lock, staleMs, Date.now())) return;
  await afterRead?.();
  const aside = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, aside);
  } catch {
    return; // another process broke it first
  }
  const moved = await readFile(aside, 'utf8').catch(() => undefined);
  if (moved !== text) {
    await link(aside, lockPath).catch(() => undefined);
  }
  await unlink(aside).catch(() => undefined);
}

async function ageMs(file: string): Promise<number> {
  const s = await stat(file).catch(() => undefined);
  return s ? Date.now() - s.mtimeMs : 0;
}
