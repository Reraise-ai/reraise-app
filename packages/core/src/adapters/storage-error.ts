// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

/**
 * Why a storage call failed, as far as a caller can act on it (ADR-0005, ADR-0016):
 * - `not_found`: the card (or version) does not exist;
 * - `conflict`: the stored state differs from what the caller based its write on (a content
 *   hash or Lage version guard) or the target already exists;
 * - `invalid`: the input or the resulting card is not valid, or a query is malformed;
 * - `locked`: the store is held by another writer or process; retry later.
 */
export const STORAGE_ERROR_CODES = ['not_found', 'conflict', 'invalid', 'locked'] as const;
export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

/**
 * The error every `StorageAdapter` throws on purpose. Anything else an adapter throws is a bug
 * or an I/O failure and is treated as an internal error. `message` must not contain card text.
 */
export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export function isStorageError(e: unknown): e is StorageError {
  return (
    e instanceof StorageError ||
    (e instanceof Error &&
      e.name === 'StorageError' &&
      (STORAGE_ERROR_CODES as readonly unknown[]).includes((e as { code?: unknown }).code))
  );
}
