// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Single-writer safety (ADR-0006, ADR-0029): one lock file per store, held only for the
// short critical section of one write. Created with the exclusive flag, which is atomic on
// every supported platform and network share that honours O_EXCL.

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
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
  release(): Promise<void>;
}

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
  return lock.host === hostname() && !pidAlive(lock.pid);
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
    host: hostname(),
    createdAt: Date.now(),
  };
  await mkdir(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({ ...content, createdAt: Date.now() }));
      } finally {
        await handle.close();
      }
      return {
        release: async () => {
          // Remove only our own lock: a stale-lock breaker may have replaced it.
          const current = parseLock(await readFile(lockPath, 'utf8').catch(() => ''));
          if (current?.token === token) await unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
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

/** Move an abandoned lock out of the way; the move is atomic, so only one breaker wins. */
async function breakIfStale(lockPath: string, staleMs: number): Promise<void> {
  const text = await readFile(lockPath, 'utf8').catch(() => undefined);
  if (text === undefined) return; // released meanwhile
  const lock = parseLock(text);
  // An unreadable file is a writer mid-creation or a crashed one; only age tells them apart.
  const unreadableAndOld = lock === undefined && (await ageMs(lockPath)) > staleMs;
  if (!unreadableAndOld && !isStale(lock, staleMs, Date.now())) return;
  const aside = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, aside);
  } catch {
    return; // another process broke it first
  }
  const moved = parseLock(await readFile(aside, 'utf8').catch(() => ''));
  if (moved && lock && moved.token !== lock.token) {
    // We moved a fresh lock that replaced the stale one: put it back if the slot is free.
    await rename(aside, lockPath).catch(() => undefined);
    return;
  }
  await unlink(aside).catch(() => undefined);
}

async function ageMs(file: string): Promise<number> {
  const s = await stat(file).catch(() => undefined);
  return s ? Date.now() - s.mtimeMs : 0;
}
