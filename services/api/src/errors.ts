// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// How an error becomes a problem (ADR-0026, RFC 9457): one mapping for both front ends, the
// HTTP error handler and the MCP tool errors (ADR-0029). The detail is fixed wording written by
// the service, never an adapter message or card text.

import { isStorageError } from '@worldbuilder/core';
import { isLocalStateError } from '@worldbuilder/local-state';
import { HttpError } from './problem.js';

const STORAGE_STATUS = { not_found: 404, conflict: 409, invalid: 400, locked: 503 } as const;
const STORAGE_DETAIL = {
  not_found: 'the store has no such card',
  conflict: 'the store holds a different state than this change was based on',
  invalid: 'the store rejected the card or the query as invalid',
  locked: 'the store is busy; try again shortly',
} as const;

export interface DescribedError {
  readonly status: number;
  readonly detail?: string;
  readonly slug?: string;
  /** Seconds a client should wait before it retries (503 `locked`). */
  readonly retryAfter?: number;
  /** The error's own code, for the log only. */
  readonly code?: string;
}

export function describeError(error: unknown): DescribedError {
  const e = error as Error & { statusCode?: number; code?: string };
  const code = e.code;
  const base = code === undefined ? {} : { code };
  if (e instanceof HttpError) {
    return {
      ...base,
      status: e.status,
      detail: e.detail,
      ...(e.slug !== undefined ? { slug: e.slug } : {}),
    };
  }
  if (isLocalStateError(e)) {
    const c: string = e.code;
    const status = c === 'invalid' ? 400 : c === 'not_found' ? 404 : c === 'conflict' ? 409 : 500;
    return { ...base, status, ...(status === 500 ? {} : { detail: e.message }) };
  }
  if (isStorageError(e)) {
    // The adapter's typed failures (ADR-0005). The detail is fixed wording plus the adapter's
    // own stable reason code: an adapter message could quote card text, so it is not sent.
    const status = STORAGE_STATUS[e.code];
    let detail: string = STORAGE_DETAIL[e.code];
    const reason = (e as { reason?: unknown }).reason;
    if (typeof reason === 'string' && /^[a-z_]{1,40}$/.test(reason)) detail += ` (${reason})`;
    return {
      ...base,
      status,
      detail,
      ...(status === 503 ? { slug: 'store-locked', retryAfter: 1 } : {}),
    };
  }
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return { ...base, status: 413, detail: 'the request body exceeds the size limit' };
  }
  if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return { ...base, status: 415, detail: 'the request body must be application/json' };
  }
  if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
    return { ...base, status: e.statusCode, detail: 'the request could not be processed' };
  }
  return { ...base, status: 500 };
}
