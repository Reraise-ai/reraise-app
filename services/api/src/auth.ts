// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Credentials (ADR-0026, ADR-0029): the human session token and the registered agent
// connections. Tokens are compared by SHA-256, so the lookup does not leak how much of a guess
// was right. The registry of agent connections is in agent-registry.ts.

import type { AgentAuthor } from '@worldbuilder/core';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type AgentTarget = 'local_model' | 'cloud_model';

/** Who is calling: the human at the board, or one registered agent connection. */
export type Principal =
  | { readonly kind: 'human' }
  | {
      readonly kind: 'agent';
      readonly name: string;
      readonly author: AgentAuthor;
      readonly target: AgentTarget;
    };

/** The disclosure target of a caller, taken from its credential and never from a request. */
export const targetOf = (p: Principal): 'screen' | AgentTarget =>
  p.kind === 'human' ? 'screen' : p.target;

/** Binding key of a connection-bound cloud transfer. */
export const connectionIdOf = (p: Principal & { kind: 'agent' }): string => p.name;

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');
/** A fresh 256-bit token, URL-safe. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export const SESSION_TOKEN_FILE = 'session-token';

/** Write a file readable by the owner only; replaces an existing file (also a symbolic link). */
export async function writePrivateFile(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  if (process.platform !== 'win32') await chmod(temp, 0o600);
  await rename(temp, file);
}
