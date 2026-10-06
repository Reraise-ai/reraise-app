// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { LocalStateError, LocalStateErrorCode } from '@worldbuilder/core';

class LocalStateFailure extends Error implements LocalStateError {
  constructor(
    readonly code: LocalStateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocalStateError';
  }
}

export function localStateError(code: LocalStateErrorCode, message: string): LocalStateError {
  return new LocalStateFailure(code, message);
}

export function isLocalStateError(e: unknown): e is LocalStateError {
  return e instanceof LocalStateFailure;
}
