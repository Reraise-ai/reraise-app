// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { STORAGE_ERROR_CODES, StorageError, isStorageError } from '../index.js';

describe('StorageError', () => {
  it('carries a closed code and is recognised', () => {
    expect(STORAGE_ERROR_CODES).toEqual(['not_found', 'conflict', 'invalid', 'locked']);
    const e = new StorageError('conflict', 'stale');
    expect(isStorageError(e)).toBe(true);
    expect(e.code).toBe('conflict');
    expect(e).toBeInstanceOf(Error);
  });

  it('recognises a copy from another module instance, but not look-alikes', () => {
    const copy = Object.assign(new Error('x'), { name: 'StorageError', code: 'locked' });
    expect(isStorageError(copy)).toBe(true);
    expect(
      isStorageError(Object.assign(new Error('x'), { name: 'StorageError', code: 'nope' })),
    ).toBe(false);
    expect(isStorageError(Object.assign(new Error('x'), { code: 'locked' }))).toBe(false);
    expect(isStorageError('not_found')).toBe(false);
  });
});
