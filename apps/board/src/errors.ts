// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { ApiError } from './api/client.js';

/** A message for the person; problems carry no card content (ADR-0026), so it is safe to show. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    return `${e.message} (${e.status})`;
  }
  return e instanceof Error ? e.message : 'Unexpected error';
}
