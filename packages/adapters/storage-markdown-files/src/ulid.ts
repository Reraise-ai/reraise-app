// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { randomBytes } from 'node:crypto';
import { encodeUlid } from '@worldbuilder/core';

/** Mint a ULID: 48 bits of milliseconds since the epoch, then 80 random bits. */
export function mintUlid(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  let t = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  bytes.set(randomBytes(10), 6);
  return encodeUlid(bytes);
}
