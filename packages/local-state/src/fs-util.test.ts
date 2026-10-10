// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Mutex, atomicWriteFile, renameWithRetry } from './fs-util.js';
import { tempDir } from './test-helpers.js';

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('atomicWriteFile', () => {
  it('writes and replaces files without leaving temp files', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'sub', 'a.json');
    await atomicWriteFile(file, 'one');
    await atomicWriteFile(file, 'two');
    expect(await readFile(file, 'utf8')).toBe('two');
    expect(await readdir(path.dirname(file))).toEqual(['a.json']);
  });

  it('keeps the old content and removes the temp file when the rename fails', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'a.json');
    await writeFile(file, 'old');
    const ops = { rename: () => Promise.reject(errno('EIO')), sleep: () => Promise.resolve() };
    await expect(atomicWriteFile(file, 'new', ops)).rejects.toThrow('EIO');
    expect(await readFile(file, 'utf8')).toBe('old');
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('never exposes partial content to a concurrent reader', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'a.json');
    const big = (c: string) => c.repeat(200_000);
    await atomicWriteFile(file, big('a'));
    let done = false;
    let writing = false;
    // The writer's outcome is captured, never left as a bare promise: a failure is rethrown
    // below, after the reader has stopped, so it cannot become an unhandled rejection.
    const writer = (async () => {
      try {
        writing = true;
        for (let i = 0; i < 40; i++) {
          await atomicWriteFile(file, big(i % 2 ? 'a' : 'b'));
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      } finally {
        writing = false;
        done = true; // a failing writer must end the reader loop
      }
    })().then(
      () => undefined,
      (e: unknown) => ({ error: e }),
    );
    // One reader polls like the board does. On Windows any open handle on the target blocks the
    // replacing rename (EPERM), so the reader must leave the writer windows: after each read it
    // pauses at least 10 ms and at least four times as long as that read took, which keeps the
    // fraction of time the file is open at or below 20 % even on a slow host. Several tight
    // readers would hold a handle almost permanently and starve the writer, which says nothing
    // about atomicity (production polls far less often). Reads and writes still interleave: the
    // writer renames every few milliseconds and the test requires reads during the write period.
    let overlapping = 0;
    const reader = async () => {
      while (!done) {
        const during = writing;
        const started = performance.now();
        const text = await readFile(file, 'utf8');
        const took = performance.now() - started;
        expect(text.length).toBe(200_000);
        expect(new Set(text).size).toBe(1);
        if (during) overlapping++;
        await new Promise((resolve) => setTimeout(resolve, Math.max(10, 4 * took)));
      }
    };
    await reader();
    const failure = await writer;
    if (failure) throw failure.error;
    // Guard against a degenerate run in which the reads all happened outside the writes.
    expect(overlapping).toBeGreaterThanOrEqual(5);
  });
});

describe('renameWithRetry (Windows sharing violations)', () => {
  it('retries transient EPERM, EACCES and EBUSY, then succeeds', async () => {
    const codes = ['EPERM', 'EACCES', 'EBUSY'];
    let calls = 0;
    const sleeps: number[] = [];
    await renameWithRetry('a', 'b', {
      rename: () => (calls++ < 3 ? Promise.reject(errno(codes[calls - 1]!)) : Promise.resolve()),
      sleep: (ms) => (sleeps.push(ms), Promise.resolve()),
      random: () => 0.999,
    });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([10, 20, 40]);
  });

  it('backs off exponentially with jitter and a bounded total of about two seconds', async () => {
    for (const [random, expected] of [
      [0.999, 2230],
      [0, 1115],
    ] as const) {
      const sleeps: number[] = [];
      const ops = {
        rename: () => Promise.reject(errno('EBUSY')),
        sleep: (ms: number) => (sleeps.push(ms), Promise.resolve()),
        random: () => random,
      };
      await expect(renameWithRetry('a', 'b', ops)).rejects.toThrow('EBUSY');
      expect(sleeps).toHaveLength(11);
      expect(sleeps.reduce((a, b) => a + b, 0)).toBe(expected);
    }
  });

  it('gives up after twelve attempts', async () => {
    let calls = 0;
    const ops = {
      rename: () => (calls++, Promise.reject(errno('EPERM'))),
      sleep: () => Promise.resolve(),
    };
    await expect(renameWithRetry('a', 'b', ops)).rejects.toThrow('EPERM');
    expect(calls).toBe(12);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    const ops = {
      rename: () => (calls++, Promise.reject(errno('ENOENT'))),
      sleep: () => Promise.resolve(),
    };
    await expect(renameWithRetry('a', 'b', ops)).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });

  it('works with the real file system', async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'x'), '1');
    await renameWithRetry(path.join(dir, 'x'), path.join(dir, 'y'));
    expect(await readdir(dir)).toEqual(['y']);
  });
});

describe('Mutex', () => {
  it('runs tasks in order and continues after a failure', async () => {
    const mutex = new Mutex();
    const order: number[] = [];
    const a = mutex.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const b = mutex.run(() => Promise.reject(new Error('boom')));
    const c = mutex.run(async () => void order.push(3));
    await expect(b).rejects.toThrow('boom');
    await Promise.all([a, c]);
    expect(order).toEqual([1, 3]);
  });
});
