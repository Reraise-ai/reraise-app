// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The e2e depends on the test ids; apps/board/README.md is their documentation. Every id in a
// component must be named there (the README writes dynamic ids as `name-<id>`).
describe('documented test ids', () => {
  it('names every data-testid of the components in the README', () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const readme = readFileSync(path.join(here, '..', 'README.md'), 'utf8');
    const dir = path.join(here, 'components');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/data-testid=(?:"([^"]+)"|\{`([a-z-]+)-\$\{)/g)) {
        const id = m[1] ?? `${m[2]}-<`;
        if (!readme.includes(id)) missing.push(`${f}: ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
