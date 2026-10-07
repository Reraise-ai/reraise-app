// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// One service per state directory (ADR-0029, ADR-0040): the receipt log, the session token and
// the proposals have a single writer. A lock file `<state>/service.lock` holds the pid and a
// hash of the host name of the running service. A lock whose holder is a dead process on this
// host is stale and is taken over; a lock of a live process, or of another host (a shared
// directory), is never broken: the second `serve` refuses to start.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

export const STATE_LOCK_FILE = 'service.lock';

interface LockContent {
  readonly pid: number;
  /** First 16 hex digits of SHA-256 of the host name: no host name is stored. */
  readonly host: string;
  readonly token: string;
  readonly createdAt: string;
}

export class StateLockedError extends Error {
  readonly code = 'state_locked';
}

const hostId = (): string => createHash('sha256').update(hostname()).digest('hex').slice(0, 16);

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parse(text: string): LockContent | undefined {
  try {
    const v = JSON.parse(text) as Partial<LockContent>;
    if (
      Number.isInteger(v.pid) &&
      typeof v.host === 'string' &&
      typeof v.token === 'string' &&
      typeof v.createdAt === 'string'
    ) {
      return v as LockContent;
    }
  } catch {
    // unreadable: judged below
  }
  return undefined;
}

export interface StateLock {
  release(): Promise<void>;
}

/** Take the lock of a state directory or throw `StateLockedError`. */
export async function acquireStateLock(stateDir: string): Promise<StateLock> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, STATE_LOCK_FILE);
  const token = randomBytes(12).toString('hex');
  const content: LockContent = {
    pid: process.pid,
    host: hostId(),
    token,
    createdAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(content)}\n`);
      } finally {
        await handle.close();
      }
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          // Remove only our own lock: a stale-lock breaker may have replaced it.
          const current = parse(await readFile(file, 'utf8').catch(() => ''));
          if (current?.token === token) await unlink(file).catch(() => undefined);
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const held = parse(await readFile(file, 'utf8').catch(() => ''));
    const stale = held !== undefined && held.host === hostId() && !pidAlive(held.pid);
    if (!stale) {
      throw new StateLockedError(
        held
          ? `another service (pid ${held.pid}) uses this state directory; stop it first (lock ${file})`
          : `the state directory lock ${file} exists and cannot be read; if no service runs, remove it`,
      );
    }
    // Atomic move: only one breaker wins; a fresh lock that took the slot is not touched
    // because the move is judged on the bytes we read.
    const aside = `${file}.stale-${randomBytes(6).toString('hex')}`;
    await rename(file, aside).catch(() => undefined);
    await unlink(aside).catch(() => undefined);
  }
  throw new StateLockedError(`could not take the state directory lock ${file}`);
}
