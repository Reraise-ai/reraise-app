// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Opening the card store of the command line. The markdown-files reference adapter is a
// separate package built in parallel (M1 slice 02); it is loaded by name when it is installed.
// This is the seam: any StorageAdapter can be passed to `createService` instead.

import type { StorageAdapter } from '@worldbuilder/core';

const ADAPTER_PACKAGE = '@worldbuilder/storage-markdown-files';

interface MarkdownAdapterModule {
  MarkdownFilesAdapter?: { open(root: string, options?: object): Promise<StorageAdapter> };
}

/** Open the store at `root` with the markdown-files adapter. */
export async function openMarkdownStore(root: string): Promise<StorageAdapter> {
  let mod: MarkdownAdapterModule;
  try {
    // A computed specifier keeps this package independent of the adapter at build time.
    mod = (await import(/* @vite-ignore */ ADAPTER_PACKAGE)) as MarkdownAdapterModule;
  } catch {
    throw new Error(
      `the markdown-files adapter (${ADAPTER_PACKAGE}) is not available in this build`,
    );
  }
  if (!mod.MarkdownFilesAdapter) {
    throw new Error(`${ADAPTER_PACKAGE} does not export MarkdownFilesAdapter yet`);
  }
  return mod.MarkdownFilesAdapter.open(root);
}
