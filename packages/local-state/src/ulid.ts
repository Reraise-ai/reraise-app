// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { randomBytes } from 'node:crypto';
import { encodeUlid } from '@worldbuilder/core';

export interface UlidOptions {
  readonly now?: () => number;
  readonly randomBytes?: (n: number) => Uint8Array;
}

/**
 * ULIDs: 48-bit millisecond time and 80 random bits. Within one millisecond the random part is
 * incremented, so ids from one factory are strictly increasing; across processes the 80 random
 * bits make a clash practically impossible.
 */
export function createUlidFactory(options: UlidOptions = {}): () => string {
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? ((n: number) => randomBytes(n));
  let lastTime = -1;
  let lastRandom = 0n;
  const toBig = (bytes: Uint8Array) => {
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    return v;
  };
  return () => {
    let time = now();
    if (time > lastTime) {
      lastRandom = toBig(random(10));
    } else {
      time = lastTime;
      lastRandom += 1n;
      if (lastRandom >= 1n << 80n) {
        time += 1; // overflow: move on to the next millisecond with fresh randomness
        lastRandom = toBig(random(10));
      }
    }
    lastTime = time;
    const bytes = new Uint8Array(16);
    let t = BigInt(time);
    for (let i = 5; i >= 0; i--) {
      bytes[i] = Number(t & 0xffn);
      t >>= 8n;
    }
    let r = lastRandom;
    for (let i = 15; i >= 6; i--) {
      bytes[i] = Number(r & 0xffn);
      r >>= 8n;
    }
    return encodeUlid(bytes);
  };
}

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
