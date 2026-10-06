// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertStateDirSafe, resolveStateDir } from './state-dir.js';
import { tempDir } from './test-helpers.js';

describe('resolveStateDir (platform simulated, host independent)', () => {
  it('linux: XDG_STATE_HOME, else ~/.local/state', () => {
    expect(
      resolveStateDir({
        platform: 'linux',
        env: { XDG_STATE_HOME: '/x/state' },
        homedir: '/home/u',
      }),
    ).toBe('/x/state/worldbuilder');
    expect(resolveStateDir({ platform: 'linux', env: {}, homedir: '/home/u' })).toBe(
      '/home/u/.local/state/worldbuilder',
    );
  });

  it('linux: ignores an empty or relative XDG_STATE_HOME', () => {
    for (const XDG_STATE_HOME of ['', 'relative/dir']) {
      expect(
        resolveStateDir({ platform: 'linux', env: { XDG_STATE_HOME }, homedir: '/home/u' }),
      ).toBe('/home/u/.local/state/worldbuilder');
    }
  });

  it('windows: %LOCALAPPDATA%\\Worldbuilder, with a home fallback', () => {
    expect(
      resolveStateDir({
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
        homedir: 'C:\\Users\\u',
      }),
    ).toBe('C:\\Users\\u\\AppData\\Local\\Worldbuilder');
    expect(resolveStateDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\u' })).toBe(
      'C:\\Users\\u\\AppData\\Local\\Worldbuilder',
    );
  });

  it('macOS: ~/Library/Application Support/Worldbuilder', () => {
    expect(resolveStateDir({ platform: 'darwin', env: {}, homedir: '/Users/u' })).toBe(
      '/Users/u/Library/Application Support/Worldbuilder',
    );
  });

  it('an explicit absolute path wins and is normalised per platform', () => {
    expect(resolveStateDir({ platform: 'linux', explicitPath: '/srv/wb//state/../s' })).toBe(
      '/srv/wb/s',
    );
    expect(resolveStateDir({ platform: 'win32', explicitPath: 'D:\\wb\\state' })).toBe(
      'D:\\wb\\state',
    );
  });

  it('rejects relative or empty explicit paths and a missing home', () => {
    expect(() => resolveStateDir({ platform: 'linux', explicitPath: 'rel/dir' })).toThrow(
      'absolute',
    );
    expect(() => resolveStateDir({ platform: 'win32', explicitPath: '/posix/style' })).toThrow(
      'absolute',
    );
    expect(() => resolveStateDir({ platform: 'linux', explicitPath: ' ' })).toThrow('absolute');
    expect(() => resolveStateDir({ platform: 'linux', env: {}, homedir: '' })).toThrow('home');
    expect(() => resolveStateDir({ platform: 'darwin', env: {}, homedir: '' })).toThrow('home');
    expect(() => resolveStateDir({ platform: 'win32', env: {}, homedir: '' })).toThrow('home');
  });

  it('uses the host defaults when nothing is injected', () => {
    expect(resolveStateDir({ explicitPath: path.resolve('/') })).toBe(
      path.normalize(path.resolve('/')),
    );
    expect(resolveStateDir({ homedir: '/h', env: {} }).length).toBeGreaterThan(0);
  });
});

async function symlinkOrSkip(target: string, link: string): Promise<boolean> {
  try {
    await symlink(target, link, 'dir');
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return false; // Windows without privilege
    throw e;
  }
}

describe('assertStateDirSafe', () => {
  it('accepts a directory outside every store root and Git tree, existing or not', async () => {
    const base = await tempDir();
    const root = path.join(base, 'store');
    await mkdir(root);
    const existing = path.join(base, 'state');
    await mkdir(existing);
    await expect(assertStateDirSafe(existing, { storeRoots: [root] })).resolves.toBeTruthy();
    await expect(
      assertStateDirSafe(path.join(base, 'not', 'yet', 'there'), { storeRoots: [root] }),
    ).resolves.toBeTruthy();
  });

  it('refuses a directory inside a store root, or equal to it, even if it does not exist yet', async () => {
    const base = await tempDir();
    const root = path.join(base, 'store');
    await mkdir(root);
    await expect(
      assertStateDirSafe(path.join(root, 'state'), { storeRoots: [root] }),
    ).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
    await expect(assertStateDirSafe(root, { storeRoots: [root] })).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
  });

  it('does not confuse a sibling with a similar name for a store root', async () => {
    const base = await tempDir();
    await mkdir(path.join(base, 'store'));
    await mkdir(path.join(base, 'store-state'));
    await expect(
      assertStateDirSafe(path.join(base, 'store-state'), {
        storeRoots: [path.join(base, 'store')],
      }),
    ).resolves.toBeTruthy();
  });

  it('refuses a directory inside a Git working tree (.git directory or worktree file)', async () => {
    const base = await tempDir();
    await mkdir(path.join(base, 'repo', '.git'), { recursive: true });
    await mkdir(path.join(base, 'repo', 'a', 'b'), { recursive: true });
    await expect(assertStateDirSafe(path.join(base, 'repo', 'a', 'b'))).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
    await expect(assertStateDirSafe(path.join(base, 'repo', 'new', 'dir'))).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
    const { writeFile } = await import('node:fs/promises');
    await mkdir(path.join(base, 'wt', 'x'), { recursive: true });
    await writeFile(path.join(base, 'wt', '.git'), 'gitdir: /elsewhere');
    await expect(assertStateDirSafe(path.join(base, 'wt', 'x'))).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
  });

  it('follows symbolic links: a link to a store root subdirectory or Git tree is refused', async () => {
    const base = await tempDir();
    const root = path.join(base, 'store');
    await mkdir(path.join(root, 'inner'), { recursive: true });
    await mkdir(path.join(base, 'repo', '.git'), { recursive: true });
    await mkdir(path.join(base, 'safe'));
    const toStore = path.join(base, 'link-store');
    const toRepo = path.join(base, 'link-repo');
    if (!(await symlinkOrSkip(path.join(root, 'inner'), toStore))) return;
    await symlinkOrSkip(path.join(base, 'repo'), toRepo);
    await expect(
      assertStateDirSafe(path.join(toStore, 'state'), { storeRoots: [root] }),
    ).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
    await expect(assertStateDirSafe(path.join(toRepo, 'state'))).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
  });

  it('follows a symbolic link on the store root side too', async () => {
    const base = await tempDir();
    await mkdir(path.join(base, 'real-store', 'state'), { recursive: true });
    const linkedRoot = path.join(base, 'linked-root');
    if (!(await symlinkOrSkip(path.join(base, 'real-store'), linkedRoot))) return;
    await expect(
      assertStateDirSafe(path.join(base, 'real-store', 'state'), { storeRoots: [linkedRoot] }),
    ).rejects.toMatchObject({ code: 'unsafe_state_dir' });
  });

  it('accepts a link that points outside, and refuses a dangling link', async () => {
    const base = await tempDir();
    await mkdir(path.join(base, 'outside'));
    const ok = path.join(base, 'ok-link');
    if (!(await symlinkOrSkip(path.join(base, 'outside'), ok))) return;
    await expect(assertStateDirSafe(ok)).resolves.toBe(
      await (await import('node:fs/promises')).realpath(ok),
    );
    const dangling = path.join(base, 'dangling');
    await symlinkOrSkip(path.join(base, 'missing-target'), dangling);
    await expect(assertStateDirSafe(path.join(dangling, 'state'))).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
  });

  it('compares case-insensitively when asked (Windows, macOS)', async () => {
    const base = await tempDir();
    const root = path.join(base, 'Store');
    await mkdir(root);
    const probe = path.join(base, 'STORE', 'state');
    await expect(
      assertStateDirSafe(probe, { storeRoots: [root], caseInsensitive: true }),
    ).rejects.toMatchObject({ code: 'unsafe_state_dir' });
    await expect(
      assertStateDirSafe(probe, { storeRoots: [root], caseInsensitive: false }),
    ).resolves.toBeTruthy();
  });
});

describe('review regressions', () => {
  it('a state dir named like "..state" inside a store root is inside it', async () => {
    const base = await tempDir();
    const root = path.join(base, 'store');
    await mkdir(root);
    await expect(
      assertStateDirSafe(path.join(root, '..state'), { storeRoots: [root] }),
    ).rejects.toMatchObject({
      code: 'unsafe_state_dir',
    });
    await expect(
      assertStateDirSafe(path.join(root, '..'), { storeRoots: [root] }),
    ).resolves.toBeTruthy();
  });

  it('refuses UNC and device paths for an explicit Windows state dir', () => {
    for (const explicitPath of [
      '\\\\server\\share\\wb',
      '//server/share/wb',
      '\\\\?\\C:\\wb',
      '\\\\.\\C:\\wb',
    ]) {
      expect(() => resolveStateDir({ platform: 'win32', explicitPath }), explicitPath).toThrow(
        'UNC',
      );
    }
    expect(resolveStateDir({ platform: 'win32', explicitPath: 'C:\\wb' })).toBe('C:\\wb');
  });
});
