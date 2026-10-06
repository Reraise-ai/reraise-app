// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarkdownStoreError } from './errors.js';
import { acquireLock, isStale } from './lock.js';
import { cleanupAfterAll, tempDir } from './testing/store.js';

cleanupAfterAll();

const lockIn = async () => path.join(await tempDir(), '.worldbuilder', 'write.lock');

/** A process id that is certainly not running: the child has exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '0']);
  return child.pid;
}

const fileOf = (over: Record<string, unknown>) =>
  JSON.stringify({
    token: 'other',
    pid: process.pid,
    host: hostname(),
    createdAt: Date.now(),
    ...over,
  });

describe('write lock', () => {
  it('is exclusive and released for the next writer', async () => {
    const file = await lockIn();
    const a = await acquireLock(file);
    await expect(acquireLock(file, { timeoutMs: 80, pollMs: 10 })).rejects.toMatchObject({
      code: 'locked',
    });
    await a.release();
    const b = await acquireLock(file, { timeoutMs: 80 });
    await b.release();
    await expect(stat(file)).rejects.toThrow();
  });

  it('a waiting writer gets the lock when the holder releases it', async () => {
    const file = await lockIn();
    const a = await acquireLock(file);
    const waiting = acquireLock(file, { timeoutMs: 2000, pollMs: 5 });
    setTimeout(() => void a.release(), 40);
    await (await waiting).release();
  });

  it('keeps writers apart: no two critical sections overlap', async () => {
    const file = await lockIn();
    let inside = 0;
    let overlap = 0;
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        const held = await acquireLock(file, { timeoutMs: 10_000, pollMs: 2 });
        inside++;
        if (inside > 1) overlap++;
        await new Promise((r) => setTimeout(r, 3));
        inside--;
        await held.release();
      }),
    );
    expect(overlap).toBe(0);
  });

  it('writes who holds it, without paths or names beyond the process', async () => {
    const file = await lockIn();
    const held = await acquireLock(file);
    const content = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(content).sort()).toEqual(['createdAt', 'host', 'pid', 'token']);
    expect(content['pid']).toBe(process.pid);
    await held.release();
  });

  it('breaks a lock older than the stale limit', async () => {
    const file = await lockIn();
    const first = await acquireLock(file);
    await writeFile(file, fileOf({ createdAt: Date.now() - 120_000, pid: process.pid }));
    const second = await acquireLock(file, { timeoutMs: 500, staleMs: 60_000, pollMs: 5 });
    await second.release();
    await first.release(); // not ours any more: must leave nothing behind and not throw
  });

  it('breaks a lock whose holder process is gone on this host', async () => {
    const file = await lockIn();
    await (await acquireLock(file)).release();
    await writeFile(file, fileOf({ pid: deadPid() }));
    const held = await acquireLock(file, { timeoutMs: 500, pollMs: 5 });
    await held.release();
  });

  it('does not break the lock of a live process, or of another host', async () => {
    const file = await lockIn();
    await (await acquireLock(file)).release();
    await writeFile(file, fileOf({ host: 'another-host', pid: deadPid() }));
    await expect(acquireLock(file, { timeoutMs: 60, pollMs: 5 })).rejects.toBeInstanceOf(
      MarkdownStoreError,
    );
    await writeFile(file, fileOf({}));
    await expect(acquireLock(file, { timeoutMs: 60, pollMs: 5 })).rejects.toMatchObject({
      code: 'locked',
    });
  });

  it('breaks an unreadable lock file only once it is old', async () => {
    const file = await lockIn();
    await (await acquireLock(file)).release();
    await writeFile(file, 'garbage');
    await expect(acquireLock(file, { timeoutMs: 60, pollMs: 5 })).rejects.toMatchObject({
      code: 'locked',
    });
    const old = new Date(Date.now() - 120_000);
    await utimes(file, old, old);
    await (await acquireLock(file, { timeoutMs: 500, staleMs: 60_000, pollMs: 5 })).release();
  });

  it('rethrows unexpected file system errors', async () => {
    const dir = await tempDir();
    const blocker = path.join(dir, 'file');
    await writeFile(blocker, 'x');
    await expect(acquireLock(path.join(blocker, 'sub', 'write.lock'))).rejects.toThrow();
  });
});

describe('isStale', () => {
  it('judges age and holder', () => {
    const now = Date.now();
    const base = { token: 't', pid: process.pid, host: hostname(), createdAt: now };
    expect(isStale(undefined, 1000, now)).toBe(false);
    expect(isStale(base, 1000, now)).toBe(false);
    expect(isStale({ ...base, createdAt: now - 5000 }, 1000, now)).toBe(true);
    expect(isStale({ ...base, pid: deadPid() }, 1000, now)).toBe(true);
    expect(isStale({ ...base, host: 'elsewhere', pid: deadPid() }, 1000, now)).toBe(false);
  });
});
