// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The public address is one constant. The board and the docs footer import it. The two READMEs
// (GitHub renders no imports) carry the "Powered by" credit again since 071fff4 and are the only
// files allowed to repeat the address; the test holds them to the constant's value.
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
  it('is written only in the constant', () => {
    const hits = files(repo)
      .filter((file) => !/\.(png|jpe?g|gif|webp|ico|woff2?|zip|pdf|map)$/i.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes(PRIVATE_EXECUTIVE_URL))
      .map((file) => path.relative(repo, file).replaceAll('\\', '/'))
      .sort();
    expect(hits).toEqual(['README.de.md', 'README.md', 'apps/board/src/privateExecutive.ts']);
  });

  it('is the address the README credit links to', () => {
    for (const readme of ['README.md', 'README.de.md']) {
      const text = readFileSync(path.join(repo, readme), 'utf8');
      const links = [...text.matchAll(/href="(https:\/\/private-executive[^"]*)"/g)].map(
        (m) => m[1],
      );
      expect(links, readme).toEqual([PRIVATE_EXECUTIVE_URL]);
    }
  });

  it('is the target the docs footer imports', () => {
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
