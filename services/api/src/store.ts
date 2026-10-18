// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Opening the card store of the command line with the markdown-files reference adapter. Any
// other StorageAdapter can be passed to `createService` instead (this is the seam).

import { encodeUlid, type StorageAdapter } from '@worldbuilder/core';
import { CONFIG_FILE, MarkdownFilesAdapter } from '@worldbuilder/storage-markdown-files';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Open the store at `root`. The folder must hold a `worldbuilder-store.yaml`, unless `init` is
 * set: then a missing configuration is created, and a new store without a `world.json` gets one
 * empty, private starter world. Existing files are never overwritten.
 */
export async function openMarkdownStore(root: string, init = false): Promise<StorageAdapter> {
  const exists = (file: string) => existsSync(path.join(root, file));
  if (init && !exists(CONFIG_FILE) && !exists('world.json')) {
    await mkdir(root, { recursive: true });
    const world = { id: encodeUlid(randomBytes(16)), name: 'My world', visibility: 'private' };
    await writeFile(path.join(root, 'world.json'), `${JSON.stringify(world, null, 2)}\n`);
  }
  return MarkdownFilesAdapter.open(root, { createIfMissing: init });
}
