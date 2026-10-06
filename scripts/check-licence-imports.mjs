// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Licence tiers (ADR-0004): Apache-2.0 packages must never depend on or import AGPL-3.0
// packages. Checks every workspace package's dependency lists, the import specifiers of its
// sources, and its TypeScript `paths` mappings.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix, walk } from './lib.mjs';

export const AGPL = 'AGPL-3.0-or-later';
const WORKSPACE_ROOTS = ['apps', 'services', 'packages', 'packages/adapters'];
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

/** Workspace packages: [{ name, dir (posix, relative), license }]. */
export function workspacePackages(repoRoot) {
  const packages = [];
  for (const root of WORKSPACE_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const file = path.join(abs, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      packages.push({ name: pkg.name, dir: `${root}/${entry.name}`, license: pkg.license, pkg });
    }
  }
  return packages;
}

/** Import specifiers in a source text. */
export function importSpecifiers(text) {
  return [...text.matchAll(IMPORT_RE)].map((m) => m[1] ?? '');
}

export function checkLicenceImports(repoRoot) {
  const packages = workspacePackages(repoRoot);
  const agpl = packages.filter((p) => p.license === AGPL);
  const isAgplName = (spec) => agpl.find((p) => spec === p.name || spec.startsWith(`${p.name}/`));
  const isAgplPath = (absPath) => {
    const rel = toPosix(path.relative(repoRoot, absPath));
    return agpl.find((p) => rel === p.dir || rel.startsWith(`${p.dir}/`));
  };
  const problems = [];

  for (const p of packages.filter((x) => x.license !== AGPL)) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const dep of Object.keys(p.pkg[field] ?? {})) {
        const target = isAgplName(dep);
        if (target) problems.push(`${p.dir}/package.json: ${field} on AGPL package ${target.name}`);
      }
    }
    const pkgDir = path.join(repoRoot, p.dir);
    for (const file of walk(pkgDir)) {
      const rel = toPosix(path.relative(repoRoot, file));
      if (/^tsconfig.*\.json$/.test(path.basename(file))) {
        const paths = JSON.parse(readFileSync(file, 'utf8')).compilerOptions?.paths ?? {};
        for (const [alias, targets] of Object.entries(paths)) {
          for (const t of targets) {
            const target = isAgplName(alias) ?? isAgplPath(path.resolve(path.dirname(file), t));
            if (target) problems.push(`${rel}: paths maps ${alias} to AGPL package ${target.name}`);
          }
        }
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(file))) continue;
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        const target = spec.startsWith('.')
          ? isAgplPath(path.resolve(path.dirname(file), spec))
          : isAgplName(spec);
        if (target) problems.push(`${rel}: imports ${spec} from AGPL package ${target.name}`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkLicenceImports(repoRoot);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\ncheck:licence-imports failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('check:licence-imports ok: no Apache-2.0 package depends on an AGPL package');
}
