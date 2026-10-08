// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarkdownStoreError } from './errors.js';
import { acquireLock, breakIfStale, hostId, isStale } from './lock.js';
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
    host: hostId(),
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

describe('stillHeld', () => {
  it('is true for the holder and false once another token owns the lock file', async () => {
    const lock = await lockIn();
    const held = await acquireLock(lock);
    expect(await held.stillHeld()).toBe(true);
    await writeFile(lock, fileOf({ token: 'other' }));
    expect(await held.stillHeld()).toBe(false);
    await held.release();
  });
});

describe('isStale', () => {
  it('judges age and holder', () => {
    const now = Date.now();
    const base = { token: 't', pid: process.pid, host: hostId(), createdAt: now };
    expect(isStale(undefined, 1000, now)).toBe(false);
    expect(isStale(base, 1000, now)).toBe(false);
    expect(isStale({ ...base, createdAt: now - 5000 }, 1000, now)).toBe(true);
    expect(isStale({ ...base, pid: deadPid() }, 1000, now)).toBe(true);
    expect(isStale({ ...base, host: 'elsewhere', pid: deadPid() }, 1000, now)).toBe(false);
  });
});

describe('breaking a stale lock', () => {
  it('puts a fresh lock back if it replaced the stale one before the move', async () => {
    const file = await lockIn();
    await (await acquireLock(file)).release();
    await writeFile(file, fileOf({ createdAt: Date.now() - 120_000, token: 'stale' }));
    const fresh = fileOf({ token: 'fresh' });
    await breakIfStale(file, 60_000, async () => {
      await writeFile(file, fresh); // another writer breaks and re-takes the lock first
    });
    expect(await readFile(file, 'utf8')).toBe(fresh);
    expect((await readdir(path.dirname(file))).filter((n) => n.includes('stale-'))).toEqual([]);
  });

  it('does the same for an unreadable old lock file', async () => {
    const file = await lockIn();
    await (await acquireLock(file)).release();
    await writeFile(file, 'garbage');
    const old = new Date(Date.now() - 120_000);
    await utimes(file, old, old);
    const fresh = fileOf({ token: 'fresh' });
    await breakIfStale(file, 60_000, async () => {
      await writeFile(file, fresh);
    });
    expect(await readFile(file, 'utf8')).toBe(fresh);
  });

  it('removes the stale lock when nothing changed, and leaves a live one alone', async () => {
    const file = await lockIn();
    await (await acquireLock(file)).release();
    await writeFile(file, fileOf({ createdAt: Date.now() - 120_000 }));
    await breakIfStale(file, 60_000);
    await expect(stat(file)).rejects.toThrow();
    await writeFile(file, fileOf({}));
    await breakIfStale(file, 60_000);
    expect((await stat(file)).isFile()).toBe(true);
  });

  it('does not re-take the slot when another writer holds it by then', async () => {
    const file = await lockIn();
    await (await acquireLock(file)).release();
    await writeFile(file, fileOf({ createdAt: Date.now() - 120_000, token: 'stale' }));
    await breakIfStale(file, 60_000, async () => {
      await writeFile(file, fileOf({ token: 'fresh' }));
    });
    // the moved fresh lock was linked back; a later writer sees a live lock
    await expect(acquireLock(file, { timeoutMs: 40, pollMs: 5 })).rejects.toMatchObject({
      code: 'locked',
    });
  });
});

describe('lock folder', () => {
  it('ignores itself in version control and records only a host hash', async () => {
    const file = await lockIn();
    const held = await acquireLock(file);
    expect(await readFile(path.join(path.dirname(file), '.gitignore'), 'utf8')).toBe('*\n');
    const { host } = JSON.parse(await readFile(file, 'utf8')) as { host: string };
    expect(host).toMatch(/^[0-9a-f]{16}$/);
    await held.release();
  });
});
