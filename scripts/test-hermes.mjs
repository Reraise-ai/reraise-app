// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// `pnpm test:hermes`: builds the `wb` command line, then runs the Python tests of
// integrations/hermes (fake Hermes harness, no hermes-agent install). Needs Python >= 3.11 with
// pytest, jsonschema and pyyaml (`pip install -e "integrations/hermes[test]"`); set PYTHON to
// choose the interpreter.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'integrations', 'hermes');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32' && cmd === 'pnpm',
    ...opts,
  });
}

const candidates = process.env.PYTHON ? [process.env.PYTHON] : ['python3', 'python', 'py'];
const python = candidates.find((c) => {
  const r = spawnSync(c, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'], {
    stdio: 'ignore',
  });
  return r.status === 0;
});
if (!python) {
  console.error('test:hermes: no Python >= 3.11 found (set PYTHON)');
  process.exit(2);
}
const deps = spawnSync(python, ['-c', 'import pytest, jsonschema, yaml'], { stdio: 'ignore' });
if (deps.status !== 0) {
  console.error(
    `test:hermes: install the test dependencies first: ${python} -m pip install -e "integrations/hermes[test]"`,
  );
  process.exit(2);
}

const build = run('pnpm', ['--filter', '@worldbuilder/knowledge-loop...', 'build']);
if (build.status !== 0) process.exit(build.status ?? 1);
const tests = spawnSync(python, ['-m', 'pytest', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: dir,
});
process.exit(tests.status ?? 1);
