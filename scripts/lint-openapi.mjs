// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Lints the Board API description with Redocly CLI (ADR-0016), with telemetry switched off.
// Cross-platform wrapper so that `pnpm lint:openapi` behaves the same on every OS.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPENAPI_FILES = ['schemas/openapi/board-api.yaml'];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@redocly/cli/package.json')),
  'bin',
  'cli.js',
);
const result = spawnSync(process.execPath, [cli, 'lint', ...OPENAPI_FILES], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true' },
});
process.exit(result.status ?? 1);
