// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Opening the card store of the command line with the markdown-files reference adapter. Any
// other StorageAdapter can be passed to `createService` instead (this is the seam).

import type { StorageAdapter } from '@worldbuilder/core';
import { MarkdownFilesAdapter } from '@worldbuilder/storage-markdown-files';

/** Open the store at `root`. The folder must hold a `worldbuilder-store.yaml`. */
export function openMarkdownStore(root: string): Promise<StorageAdapter> {
  return MarkdownFilesAdapter.open(root);
}
