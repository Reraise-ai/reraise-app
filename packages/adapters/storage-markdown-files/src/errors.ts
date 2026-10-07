// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { StorageError, type StorageErrorCode } from '@worldbuilder/core';

/** The adapter's own, finer reasons; each maps to one `StorageErrorCode` of the contract. */
export type MarkdownStoreReason =
  | 'invalid_card'
  | 'invalid_patch'
  | 'invalid_query'
  | 'not_found'
  | 'conflict'
  | 'locked'
  | 'bad_store'
  | 'parse';

const CODE_OF: Readonly<Record<MarkdownStoreReason, StorageErrorCode>> = {
  invalid_card: 'invalid',
  invalid_patch: 'invalid',
  invalid_query: 'invalid',
  bad_store: 'invalid',
  parse: 'invalid',
  not_found: 'not_found',
  conflict: 'conflict',
  locked: 'locked',
};

/**
 * Every error the adapter raises on purpose. It is a `StorageError` (ADR-0005), so callers act
 * on `code` (`not_found`, `conflict`, `invalid`, `locked`) and need not know this adapter;
 * `reason` is the adapter's finer, stable reason for its own tests and diagnostics.
 */
export class MarkdownStoreError extends StorageError {
  constructor(
    readonly reason: MarkdownStoreReason,
    message: string,
  ) {
    super(CODE_OF[reason], message);
    this.name = 'StorageError';
  }
}
