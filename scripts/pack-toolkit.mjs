// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Packs the toolkit: the built service with its production dependencies, the built board, the
// Board API contract, the examples and the licence files. The folder keeps the repository
// layout, so it starts with plain Node 22 exactly like a checkout:
//   node services/api/dist/cli.js serve --init --store ./my-world      (or: npm start -- ...)
// The folder is also the npm package @reraise/app (see its package.json below).
// Run `pnpm build` first. Writes dist/toolkit/ and dist/reraise-toolkit-<version>.zip
// (the zip needs `zip` on the PATH; --no-zip writes the folder only, as the Dockerfile does).
//   node scripts/pack-toolkit.mjs [--version <x.y.z>] [--no-zip]

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: { version: { type: 'string' }, 'no-zip': { type: 'boolean' } },
});
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
const rootPkg = readJson(path.join(root, 'package.json'));
const version = values.version ?? rootPkg.version;
const out = path.join(root, 'dist', 'toolkit');
const api = path.join(out, 'services', 'api');
const copy = (rel, filter) =>
  cpSync(path.join(root, rel), path.join(out, rel), { recursive: true, filter });

for (const built of ['services/api/dist/cli.js', 'apps/board/dist/index.html']) {
  if (!existsSync(path.join(root, built))) throw new Error(`${built} is missing: run pnpm build`);
}
rmSync(out, { recursive: true, force: true });

// A flat node_modules of plain copies: a zip keeps no symbolic link on every platform, and npm
// drops the hard-link entries of a tarball (pnpm links identical files from its store).
// `--legacy`: pnpm 10 deploys workspace dependencies this way without inject-workspace-packages.
execFileSync(
  'pnpm',
  [
    '--filter',
    '@worldbuilder/api',
    'deploy',
    '--prod',
    '--legacy',
    '--config.node-linker=hoisted',
    '--config.package-import-method=copy',
    api,
  ],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
rmSync(path.join(api, 'node_modules', '.bin'), { recursive: true, force: true });
// At the top, where `npm pack` takes bundled dependencies from; Node finds them from services/api.
renameSync(path.join(api, 'node_modules'), path.join(out, 'node_modules'));

copy('apps/board/dist', (src) => !path.basename(src).startsWith('demo'));
copy('schemas/openapi/board-api.yaml');
for (const rel of ['examples', 'LICENSE', 'LICENSING.md', 'LICENSES', 'README.md']) copy(rel);

// The top package.json is the one publishable package, @reraise/app (`npm pack` in the folder,
// then `npx ./reraise-app-<version>.tgz serve --init --store <folder>`): the exact versions it
// bundles, the `reraise` command. The service's own package.json only keeps its module type.
const apiPkg = readJson(path.join(api, 'package.json'));
writeJson(path.join(api, 'package.json'), {
  name: apiPkg.name,
  version,
  private: true,
  license: apiPkg.license,
  type: apiPkg.type,
});
const bundled = Object.keys(apiPkg.dependencies);
writeJson(path.join(out, 'package.json'), {
  name: '@reraise/app',
  version,
  description: 'The Reraise toolkit: the Worldbuilder service and board in one command',
  license: 'AGPL-3.0-or-later',
  type: 'module',
  engines: rootPkg.engines,
  bin: { reraise: 'services/api/dist/cli.js' },
  scripts: { start: rootPkg.scripts.start },
  dependencies: Object.fromEntries(
    bundled.map((name) => [
      name,
      readJson(path.join(out, 'node_modules', name, 'package.json')).version,
    ]),
  ),
  bundleDependencies: bundled,
});

if (values['no-zip']) {
  console.log(`packed ${path.relative(root, out)}`);
} else {
  const zip = path.join(root, 'dist', `reraise-toolkit-${version}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out, stdio: 'inherit' });
  console.log(`packed ${path.relative(root, zip)}`);
}
