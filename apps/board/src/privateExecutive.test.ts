// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The public address is one constant. The README carries the same link because a Markdown file
// cannot import it. Nothing else in the tree may copy the address.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRIVATE_EXECUTIVE_URL } from './privateExecutive.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  'cache',
  'playwright-report',
  'test-results',
]);

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, out);
    else out.push(full);
  }
  return out;
}

describe('PRIVATE_EXECUTIVE_URL', () => {
  it('is written only in the constant and the README link', () => {
    const hits = files(repo)
      .filter((file) => !/\.(png|jpe?g|gif|webp|ico|woff2?|zip|pdf|map)$/i.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes(PRIVATE_EXECUTIVE_URL))
      .map((file) => path.relative(repo, file).replaceAll('\\', '/'))
      .sort();
    expect(hits).toEqual(['README.md', 'apps/board/src/privateExecutive.ts']);
  });

  it('is the README line and the target the docs footer imports', () => {
    const readme = readFileSync(path.join(repo, 'README.md'), 'utf8');
    expect(readme).toContain(
      `_The Worldbuilder — Powered by [Private Executive](${PRIVATE_EXECUTIVE_URL})_`,
    );
    const config = readFileSync(path.join(repo, 'docs/.vitepress/config.mts'), 'utf8');
    expect(config).toContain("from '../../apps/board/src/privateExecutive.ts'");
    expect(config).toContain('Powered by');
    expect(config).toContain('href="${PRIVATE_EXECUTIVE_URL}"');
    expect(config).toContain('target="_blank"');
    expect(config).toContain('rel="noopener noreferrer"');
    expect(config).toContain('Private Executive');
    expect(config).not.toContain(PRIVATE_EXECUTIVE_URL);
  });
});
