// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Rate limiting of the Board API (ADR-0047). Two limits, both in memory and both answered with a
// 429 problem and a Retry-After header:
//   - requests per credential (or per address when there is none), the official @fastify/rate-limit
//     plugin, so a runaway local client cannot flood the service;
//   - failed credentials per address, so a local process cannot guess tokens at speed. After the
//     allowed number of failures in a window every request from that address is refused until the
//     window has passed, a valid token included (otherwise a correct guess would pass at full speed).

import { sha256Hex } from './auth.js';
import type { FastifyRequest } from 'fastify';

export interface RateLimitOptions {
  /** Requests allowed per credential and window. Default 600 (the board polls every 2 seconds). */
  readonly max?: number;
  /** Window length in milliseconds. Default 60 000. */
  readonly windowMs?: number;
  /** Failed credentials allowed per address and window before it is locked out. Default 10. */
  readonly authFailureMax?: number;
}

export const DEFAULT_RATE_LIMIT = { max: 600, windowMs: 60_000, authFailureMax: 10 } as const;

/** Keeps requests with and without a credential apart without holding a token in memory. */
export function rateLimitKey(req: FastifyRequest): string {
  const session = req.headers['x-worldbuilder-session'];
  const bearer = req.headers.authorization;
  const credential = typeof session === 'string' ? session : bearer;
  return credential === undefined ? `ip:${req.ip}` : `cred:${sha256Hex(credential)}`;
}

/** Failed-credential counter per address; fixed window, bounded memory. */
export class AuthFailureLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private static readonly MAX_ADDRESSES = 1024;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  private current(address: string): { start: number; count: number } | undefined {
    const w = this.windows.get(address);
    if (w === undefined) return undefined;
    if (this.now() - w.start >= this.windowMs) {
      this.windows.delete(address);
      return undefined;
    }
    return w;
  }

  /** Seconds until the address may try again, or undefined when it is not locked out. */
  lockedFor(address: string): number | undefined {
    const w = this.current(address);
    if (w === undefined || w.count < this.max) return undefined;
    return Math.max(1, Math.ceil((w.start + this.windowMs - this.now()) / 1000));
  }

  recordFailure(address: string): void {
    const w = this.current(address);
    if (w !== undefined) {
      w.count += 1;
      return;
    }
    if (this.windows.size >= AuthFailureLimiter.MAX_ADDRESSES) {
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }
    this.windows.set(address, { start: this.now(), count: 1 });
  }
}
