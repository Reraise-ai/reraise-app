// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// REUSE-IgnoreStart
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix, walk } from './lib.mjs';

export const APACHE = 'Apache-2.0';
export const AGPL = 'AGPL-3.0-or-later';
export const COPYRIGHT = 'Copyright The Worldbuilder contributors';

/** Directories (relative, posix) licensed AGPL. Everything else is Apache-2.0. */
export const AGPL_DIRS = ['apps/board', 'services/api', 'packages/mcp-server', 'e2e'];
export const SCAN_ROOTS = ['apps', 'services', 'packages', 'scripts', 'e2e'];
/** Directories whose non-commentable files are covered by REUSE.toml. */
export const DATA_ROOTS = [...SCAN_ROOTS, 'schemas', 'examples', 'docs', 'prototype'];
export const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html']);
export const ROOT_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);
export const DATA_EXTENSIONS = new Set([
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.yml',
  '.yaml',
]);

export function expectedLicense(relPosix) {
  return AGPL_DIRS.some((d) => relPosix === d || relPosix.startsWith(`${d}/`)) ? AGPL : APACHE;
}

const HEADER_RE =
  /^\s*(?:\/\/|\/\*|<!--)\s*SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)\s*(?:\*\/|-->)?\s*$/;

/** Return the SPDX id found in the first 5 lines, or null. */
export function findSpdx(content) {
  for (const line of content.split(/\r?\n/).slice(0, 5)) {
    const m = HEADER_RE.exec(line);
    if (m) return m[1];
  }
  return null;
}

export function hasCopyright(content) {
  return content
    .split(/\r?\n/)
    .slice(0, 5)
    .some((l) => l.includes(COPYRIGHT));
}

/** Minimal REUSE.toml reader: returns [{ paths: string[], license: string }]. */
export function parseReuseToml(text) {
  /** @type {{ paths: string[], license: string | null }[]} */
  const annotations = [];
  /** @type {{ paths: string[], license: string | null } | null} */
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '[[annotations]]') {
      current = { paths: [], license: null };
      annotations.push(current);
    } else if (current && line.startsWith('path')) {
      current.paths = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    } else if (current && line.startsWith('SPDX-License-Identifier')) {
      current.license = /"([^"]+)"/.exec(line)?.[1] ?? null;
    }
  }
  return annotations;
}

function globToRegExp(glob) {
  const src = glob
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${src}$`);
}

/** Licence assigned by REUSE.toml to a path (last matching annotation wins), or null. */
export function reuseLicenseFor(annotations, relPosix) {
  let found = null;
  for (const a of annotations) {
    if (a.paths.some((p) => globToRegExp(p).test(relPosix))) found = a.license;
  }
  return found;
}

function* packageDirs(repoRoot) {
  for (const root of ['apps', 'services', 'packages', 'e2e']) {
    const abs = path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    for (const f of walk(abs)) {
      if (path.basename(f) === 'package.json') yield path.dirname(f);
    }
  }
}

/** Check all files under the roots of `repoRoot`. Returns a list of problem strings. */
export function checkSpdx(repoRoot) {
  const problems = [];

  const check = (file) => {
    const rel = toPosix(path.relative(repoRoot, file));
    const want = expectedLicense(rel);
    const content = readFileSync(file, 'utf8');
    const got = findSpdx(content);
    if (got === null) problems.push(`${rel}: missing SPDX-License-Identifier (expected ${want})`);
    else if (got !== want) problems.push(`${rel}: SPDX ${got} does not match tier ${want}`);
    else if (!hasCopyright(content)) problems.push(`${rel}: missing "${COPYRIGHT}" line`);
  };

  for (const root of SCAN_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      if (EXTENSIONS.has(path.extname(file))) check(file);
    }
  }
  for (const name of readdirSync(repoRoot)) {
    const file = path.join(repoRoot, name);
    if (ROOT_EXTENSIONS.has(path.extname(name)) && existsSync(file)) check(file);
  }

  // Non-commentable files: tier comes from REUSE.toml.
  const reusePath = path.join(repoRoot, 'REUSE.toml');
  const annotations = existsSync(reusePath)
    ? parseReuseToml(readFileSync(reusePath, 'utf8'))
    : null;
  for (const root of DATA_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      if (!DATA_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const rel = toPosix(path.relative(repoRoot, file));
      if (annotations === null) {
        problems.push(`${rel}: REUSE.toml missing, cannot determine licence`);
        continue;
      }
      const want = expectedLicense(rel);
      const got = reuseLicenseFor(annotations, rel);
      if (got === null) problems.push(`${rel}: not covered by REUSE.toml (expected ${want})`);
      else if (got !== want) problems.push(`${rel}: REUSE.toml says ${got}, tier is ${want}`);
    }
  }

  // Each package LICENSE must be the exact text matching its package.json licence.
  for (const dir of packageDirs(repoRoot)) {
    const rel = toPosix(path.relative(repoRoot, dir));
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const want = expectedLicense(rel);
    if (pkg.license !== want) {
      problems.push(`${rel}/package.json: license ${pkg.license} does not match tier ${want}`);
    }
    const licenseFile = path.join(dir, 'LICENSE');
    const reference = path.join(repoRoot, 'LICENSES', `${pkg.license}.txt`);
    if (!existsSync(licenseFile)) problems.push(`${rel}/LICENSE: missing`);
    else if (!existsSync(reference)) problems.push(`LICENSES/${pkg.license}.txt: missing`);
    else if (readFileSync(licenseFile, 'utf8') !== readFileSync(reference, 'utf8')) {
      problems.push(`${rel}/LICENSE: does not match LICENSES/${pkg.license}.txt`);
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
// REUSE-IgnoreEnd
