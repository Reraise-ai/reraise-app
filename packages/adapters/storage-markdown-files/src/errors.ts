// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

/** Base class of every error the adapter raises on purpose; `code` is stable for callers. */
export class MarkdownStoreError extends Error {
  constructor(
    readonly code:
      | 'invalid_card'
      | 'invalid_patch'
      | 'invalid_query'
      | 'not_found'
      | 'conflict'
      | 'locked'
      | 'bad_store'
      | 'parse',
    message: string,
  ) {
    super(message);
    this.name = 'MarkdownStoreError';
  }
}
