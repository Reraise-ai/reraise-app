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
 * set: then a missing store is created with one empty, private starter world. An existing store
 * is opened as it is.
 */
export async function openMarkdownStore(root: string, init = false): Promise<StorageAdapter> {
  if (init && !existsSync(path.join(root, CONFIG_FILE))) {
    await mkdir(root, { recursive: true });
    const world = { id: encodeUlid(randomBytes(16)), name: 'My world', visibility: 'private' };
    // `wx`: a world file that is already there is never overwritten.
    await writeFile(path.join(root, 'world.json'), `${JSON.stringify(world, null, 2)}\n`, {
      flag: 'wx',
    });
  }
  return MarkdownFilesAdapter.open(root, { createIfMissing: init });
}
