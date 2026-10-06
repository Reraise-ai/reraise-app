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
  it('retries transient errors and then succeeds', async () => {
    let calls = 0;
    await renameWithRetry('a', 'b', async () => {
      if (++calls < 3) throw errno(calls === 1 ? 'EPERM' : 'EBUSY');
    });
    expect(calls).toBe(3);
  });

  it('gives up after the attempts and does not retry other errors', async () => {
    let calls = 0;
    await expect(
      renameWithRetry(
        'a',
        'b',
        async () => {
          calls++;
          throw errno('EACCES');
        },
        3,
      ),
    ).rejects.toThrow('EACCES');
    expect(calls).toBe(3);
    calls = 0;
    await expect(
      renameWithRetry('a', 'b', async () => {
        calls++;
        throw errno('ENOENT');
      }),
    ).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });
});
