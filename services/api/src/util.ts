// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

import { encodeUlid } from '@worldbuilder/core';

/** A fresh ULID from 128 secure random bits (always below the ULID range). */
export function newUlid(): string {
  return encodeUlid(crypto.getRandomValues(new Uint8Array(16)));
}

/** Runs tasks one at a time, in order; one failing task does not stop the next. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
