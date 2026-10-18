// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Packs the toolkit: the built service with its production dependencies, the built board, the
// Board API contract, the examples and the licence files. The folder keeps the repository
// layout, so it starts with plain Node 22 exactly like a checkout:
//   node services/api/dist/cli.js serve --init --store ./my-world      (or: npm start -- ...)
// Run `pnpm build` first. Writes dist/toolkit/ and dist/reraise-toolkit-<version>.zip
// (the zip needs `zip` on the PATH; --no-zip writes the folder only, as the Dockerfile does).
//   node scripts/pack-toolkit.mjs [--version <x.y.z>] [--no-zip]

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// A flat node_modules without symbolic links, so the folder survives a zip on every platform.
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
    api,
  ],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
rmSync(path.join(api, 'node_modules', '.bin'), { recursive: true, force: true });

copy('apps/board/dist', (src) => !path.basename(src).startsWith('demo'));
copy('schemas/openapi/board-api.yaml');
for (const rel of ['examples', 'LICENSE', 'LICENSING.md', 'LICENSES', 'README.md']) copy(rel);

// The service's package.json: the release version and the exact versions it bundles.
const apiPkg = readJson(path.join(api, 'package.json'));
const dependencies = Object.fromEntries(
  Object.keys(apiPkg.dependencies).map((name) => [
    name,
    readJson(path.join(api, 'node_modules', name, 'package.json')).version,
  ]),
);
delete apiPkg.devDependencies;
writeJson(path.join(api, 'package.json'), {
  ...apiPkg,
  version,
  scripts: { start: apiPkg.scripts.start },
  dependencies,
});
writeJson(path.join(out, 'package.json'), {
  name: 'reraise-toolkit',
  version,
  private: true,
  license: 'AGPL-3.0-or-later',
  type: 'module',
  engines: rootPkg.engines,
  scripts: { start: rootPkg.scripts.start },
});

if (values['no-zip']) {
  console.log(`packed ${path.relative(root, out)}`);
} else {
  const zip = path.join(root, 'dist', `reraise-toolkit-${version}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out, stdio: 'inherit' });
  console.log(`packed ${path.relative(root, zip)}`);
}
