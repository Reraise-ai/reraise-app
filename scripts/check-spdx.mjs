// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix, walk } from './lib.mjs';

export const APACHE = 'Apache-2.0';
export const AGPL = 'AGPL-3.0-or-later';

/** Directories (relative, posix) licensed AGPL. Everything else scanned is Apache-2.0. */
export const AGPL_DIRS = ['apps/board', 'services/api', 'packages/mcp-server'];
export const SCAN_ROOTS = ['apps', 'services', 'packages', 'scripts'];
export const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css']);

export function expectedLicense(relPosix) {
  return AGPL_DIRS.some((d) => relPosix === d || relPosix.startsWith(`${d}/`)) ? AGPL : APACHE;
}

const HEADER_RE =
  /^\s*(?:\/\/|\/\*)\s*SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)\s*(?:\*\/)?\s*$/;

/** Return the SPDX id found in the first 5 lines, or null. */
export function findSpdx(content) {
  const lines = content.split(/\r?\n/).slice(0, 5);
  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Check all files under the roots of `repoRoot`. Returns a list of problem strings. */
export function checkSpdx(repoRoot) {
  const problems = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      if (!EXTENSIONS.has(path.extname(file))) continue;
      const rel = toPosix(path.relative(repoRoot, file));
      const want = expectedLicense(rel);
      const got = findSpdx(readFileSync(file, 'utf8'));
      if (got === null) problems.push(`${rel}: missing SPDX-License-Identifier (expected ${want})`);
      else if (got !== want) problems.push(`${rel}: SPDX ${got} does not match tier ${want}`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkSpdx(repoRoot);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\ncheck:spdx failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('check:spdx ok');
}
