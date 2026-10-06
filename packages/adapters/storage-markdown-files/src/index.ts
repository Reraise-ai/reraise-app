// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

export const ADAPTER_ID = 'markdown-files';

export {
  ARCHIVE_DIR,
  CARDS_DIR,
  CONFIG_FILE,
  LOCK_FILE,
  MarkdownFilesAdapter,
  type Diagnostic,
  type MarkdownSearchQuery,
  type OpenOptions,
} from './adapter.js';
export { MarkdownStoreError } from './errors.js';
export { acquireLock, type HeldLock, type LockOptions } from './lock.js';
