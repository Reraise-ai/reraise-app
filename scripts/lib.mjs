// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.vitepress',
]);

/** Recursively list files under `dir`, skipping build/vendor directories. */
export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}
