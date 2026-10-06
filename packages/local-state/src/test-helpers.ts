// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const dirs: string[] = [];

/** A fresh temp directory, removed after each test. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wb-local-state-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

export const CARD_A = '01J9Z0000000000000000000A1';
export const CARD_B = '01J9Z0000000000000000000B2';
export const LAGE = '01J9Z0000000000000000000M3';
