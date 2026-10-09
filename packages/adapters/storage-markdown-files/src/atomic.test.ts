// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renameWithRetry, writeAtomic } from './atomic.js';
import { cleanupAfterAll, tempDir } from './testing/store.js';

cleanupAfterAll();

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('writeAtomic', () => {
  it('replaces the file and leaves no temporary file behind', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'card.md');
    await writeFile(file, 'old');
    await writeAtomic(file, 'new\n');
    expect(await readFile(file, 'utf8')).toBe('new\n');
    expect(await readdir(dir)).toEqual(['card.md']);
  });

  it('cleans up and rethrows when the target cannot be written', async () => {
    const dir = await tempDir();
    await expect(writeAtomic(path.join(dir, 'missing', 'card.md'), 'x')).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('renameWithRetry', () => {
  const failing = (code: string, sleeps: number[], random: number, count?: { n: number }) => ({
    rename: async () => {
      if (count) count.n++;
      throw errno(code);
    },
    sleep: async (ms: number) => void sleeps.push(ms),
    random: () => random,
  });

  it('retries transient errors and then succeeds', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    await renameWithRetry('a', 'b', {
      rename: async () => {
        if (++calls < 4) throw errno(['EPERM', 'EACCES', 'EBUSY'][calls - 1]!);
      },
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0.999,
    });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([10, 20, 40]);
  });

  it('follows the exponential schedule with equal jitter, 12 attempts, then the original error', async () => {
    for (const [random, expected] of [
      [0, [5, 10, 20, 40, 80, 160, 160, 160, 160, 160, 160]],
      [0.999, [10, 20, 40, 80, 160, 320, 320, 320, 320, 320, 320]],
    ] as const) {
      const sleeps: number[] = [];
      const count = { n: 0 };
      await expect(
        renameWithRetry('a', 'b', failing('EACCES', sleeps, random, count)),
      ).rejects.toThrow('EACCES');
      expect(count.n).toBe(12);
      expect(sleeps).toEqual(expected);
    }
  });

  it('does not retry other errors', async () => {
    const count = { n: 0 };
    await expect(renameWithRetry('a', 'b', failing('ENOENT', [], 0, count))).rejects.toThrow(
      'ENOENT',
    );
    expect(count.n).toBe(1);
  });

  it('removes the temporary file after the retries are exhausted', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'card.md');
    await writeFile(file, 'old');
    await expect(writeAtomic(file, 'new', failing('EPERM', [], 0))).rejects.toThrow('EPERM');
    expect(await readdir(dir)).toEqual(['card.md']);
    expect(await readFile(file, 'utf8')).toBe('old');
  });
});
