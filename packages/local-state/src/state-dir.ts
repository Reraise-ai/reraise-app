// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// State directory (ADR-0030): per-OS default or an explicit path, and the refusal to use a
// directory inside a configured store root or a Git working tree, symbolic links followed.

import { lstat, realpath } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';
import { localStateError } from './errors.js';

export interface ResolveStateDirOptions {
  /** Operating system as `process.platform` names it; defaults to the host's. */
  readonly platform?: string;
  /** Environment; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Home directory; defaults to `os.homedir()`. */
  readonly homedir?: string;
  /** An explicitly configured path; wins over the default. Must be absolute. */
  readonly explicitPath?: string;
}

/**
 * The state directory: the explicit path if given, else `$XDG_STATE_HOME/worldbuilder` (or
 * `~/.local/state/worldbuilder`), `%LOCALAPPDATA%\Worldbuilder` or
 * `~/Library/Application Support/Worldbuilder`. Pure: nothing is read from or written to disk.
 */
export function resolveStateDir(options: ResolveStateDirOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (options.explicitPath !== undefined) {
    if (
      options.explicitPath.trim() === '' ||
      !p.isAbsolute(options.explicitPath) ||
      (platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(options.explicitPath))
    ) {
      throw new Error('the state directory path must be absolute');
    }
    return p.normalize(options.explicitPath);
  }
  const home = options.homedir ?? osHomedir();
  const needHome = () => {
    if (!home) throw new Error('cannot resolve the state directory: no home directory');
    return home;
  };
  if (platform === 'win32') {
    const base = env['LOCALAPPDATA'];
    return p.join(
      base && p.isAbsolute(base) ? base : p.join(needHome(), 'AppData', 'Local'),
      'Worldbuilder',
    );
  }
  if (platform === 'darwin') {
    return p.join(needHome(), 'Library', 'Application Support', 'Worldbuilder');
  }
  const xdg = env['XDG_STATE_HOME'];
  // The XDG specification says a relative XDG_STATE_HOME is invalid and must be ignored.
  return p.join(
    xdg && p.isAbsolute(xdg) ? xdg : p.join(needHome(), '.local', 'state'),
    'worldbuilder',
  );
}

export interface StateDirSafetyOptions {
  /** Roots of every configured card store. */
  readonly storeRoots?: readonly string[];
  /** Compare paths case-insensitively; defaults to true on Windows and macOS hosts. */
  readonly caseInsensitive?: boolean;
}

/** Real path of `p` even if its tail does not exist yet; a dangling symlink is an error. */
async function realpathLoose(p: string): Promise<string> {
  const rest: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest.reverse());
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e;
      const info = await lstat(current).catch(() => undefined);
      if (info?.isSymbolicLink()) {
        throw localStateError(
          'unsafe_state_dir',
          'the state directory path contains a dangling symbolic link',
        );
      }
      const parent = path.dirname(current);
      if (parent === current) throw e;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(child: string, root: string, fold: boolean): boolean {
  const c = fold ? child.toLowerCase() : child;
  const r = fold ? root.toLowerCase() : root;
  const rel = path.relative(r, c);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Throws `unsafe_state_dir` if `stateDir`, after following symbolic links, is inside (or is)
 * a store root or lies in a Git working tree (an ancestor holds a `.git` entry). Returns the
 * real path. The directory need not exist yet.
 */
export async function assertStateDirSafe(
  stateDir: string,
  options: StateDirSafetyOptions = {},
): Promise<string> {
  const fold =
    options.caseInsensitive ?? (process.platform === 'win32' || process.platform === 'darwin');
  const real = await realpathLoose(stateDir);
  for (const root of options.storeRoots ?? []) {
    const realRoot = await realpathLoose(root);
    if (isInside(real, realRoot, fold)) {
      throw localStateError('unsafe_state_dir', 'the state directory is inside a store root');
    }
  }
  for (let dir = real; ; dir = path.dirname(dir)) {
    const git = await lstat(path.join(dir, '.git')).catch(() => undefined);
    if (git) {
      throw localStateError('unsafe_state_dir', 'the state directory is inside a Git working tree');
    }
    if (path.dirname(dir) === dir) break;
  }
  return real;
}
