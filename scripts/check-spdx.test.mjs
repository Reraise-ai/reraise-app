// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// REUSE-IgnoreStart
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkSpdx,
  expectedLicense,
  findSpdx,
  hasCopyright,
  parseReuseToml,
  reuseLicenseFor,
} from './check-spdx.mjs';
import { makeTree } from './test-helpers.mjs';

const C = '// Copyright The Worldbuilder contributors\n';
const A = `// SPDX-License-Identifier: Apache-2.0\n${C}`;
const G = `// SPDX-License-Identifier: AGPL-3.0-or-later\n${C}`;
const APACHE_TEXT = 'apache text\n';
const AGPL_TEXT = 'agpl text\n';
const REUSE = readFileSync(new URL('../REUSE.toml', import.meta.url), 'utf8');
const base = {
  'REUSE.toml': REUSE,
  'LICENSES/Apache-2.0.txt': APACHE_TEXT,
  'LICENSES/AGPL-3.0-or-later.txt': AGPL_TEXT,
};

describe('expectedLicense', () => {
  it('maps tiers by directory', () => {
    expect(expectedLicense('apps/board/src/a.ts')).toBe('AGPL-3.0-or-later');
    expect(expectedLicense('services/api/src/a.ts')).toBe('AGPL-3.0-or-later');
    expect(expectedLicense('packages/mcp-server/src/a.ts')).toBe('AGPL-3.0-or-later');
    expect(expectedLicense('packages/core/src/a.ts')).toBe('Apache-2.0');
    expect(expectedLicense('scripts/a.mjs')).toBe('Apache-2.0');
  });
});

describe('findSpdx / hasCopyright', () => {
  it('reads line, block and html comment headers', () => {
    expect(findSpdx(A)).toBe('Apache-2.0');
    expect(findSpdx('/* SPDX-License-Identifier: AGPL-3.0-or-later */\n')).toBe(
      'AGPL-3.0-or-later',
    );
    expect(findSpdx('<!doctype html>\n<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n')).toBe(
      'AGPL-3.0-or-later',
    );
    expect(findSpdx('const x = 1;\n')).toBeNull();
  });

  it('requires the copyright line near the top', () => {
    expect(hasCopyright(A)).toBe(true);
    expect(hasCopyright('// SPDX-License-Identifier: Apache-2.0\n')).toBe(false);
  });
});

describe('REUSE.toml', () => {
  it('parses annotations and lets the last match win', () => {
    const ann = parseReuseToml(REUSE);
    expect(reuseLicenseFor(ann, 'docs/a.md')).toBe('Apache-2.0');
    expect(reuseLicenseFor(ann, 'apps/board/logo.png')).toBe('AGPL-3.0-or-later');
    expect(reuseLicenseFor(ann, 'packages/core/package.json')).toBe('Apache-2.0');
    expect(reuseLicenseFor([], 'a.json')).toBeNull();
  });
});

describe('checkSpdx', () => {
  it('passes on correct headers, data files and package licences', () => {
    const root = makeTree({
      ...base,
      'packages/core/src/a.ts': `${A}export {};\n`,
      'packages/core/package.json': '{"license":"Apache-2.0"}',
      'packages/core/LICENSE': APACHE_TEXT,
      'apps/board/src/a.tsx': `${G}export {};\n`,
      'apps/board/src/a.css':
        '/* SPDX-License-Identifier: AGPL-3.0-or-later */\n/* Copyright The Worldbuilder contributors */\n',
      'apps/board/index.html':
        '<!doctype html>\n<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n<!-- Copyright The Worldbuilder contributors -->\n',
      'apps/board/package.json': '{"license":"AGPL-3.0-or-later"}',
      'apps/board/LICENSE': AGPL_TEXT,
      'apps/board/logo.png': 'x',
      'schemas/card.schema.json': '{}',
      'eslint.config.js': `${A}export default [];\n`,
      'packages/core/README.md': 'no header needed\n',
      'packages/core/node_modules/x/index.js': 'ignored\n',
    });
    expect(checkSpdx(root)).toEqual([]);
  });

  it('reports missing, mismatching and copyright-less headers', () => {
    const root = makeTree({
      ...base,
      'packages/core/src/missing.ts': 'export {};\n',
      'packages/core/src/wrong.ts': `${G}export {};\n`,
      'services/api/src/wrong.ts': `${A}export {};\n`,
      'packages/core/src/nocopy.ts': '// SPDX-License-Identifier: Apache-2.0\nexport {};\n',
      'apps/board/index.html': '<!doctype html>\n',
      'vitest.config.ts': 'export default {};\n',
    });
    const out = checkSpdx(root).join('\n');
    expect(out).toContain('packages/core/src/missing.ts: missing');
    expect(out).toContain('packages/core/src/wrong.ts: SPDX AGPL-3.0-or-later');
    expect(out).toContain('services/api/src/wrong.ts: SPDX Apache-2.0');
    expect(out).toContain('packages/core/src/nocopy.ts: missing "Copyright');
    expect(out).toContain('apps/board/index.html: missing');
    expect(out).toContain('vitest.config.ts: missing');
  });

  it('checks REUSE coverage for json and images', () => {
    const wrong = '[[annotations]]\npath = ["**"]\nSPDX-License-Identifier = "Apache-2.0"\n';
    const root = makeTree({
      ...base,
      'REUSE.toml': wrong,
      'apps/board/logo.png': 'x',
    });
    expect(checkSpdx(root).join('\n')).toContain(
      'apps/board/logo.png: REUSE.toml says Apache-2.0, tier is AGPL-3.0-or-later',
    );
    const none = makeTree({ 'schemas/a.json': '{}' });
    expect(checkSpdx(none).join('\n')).toContain('REUSE.toml missing');
  });

  it('checks package licence field and LICENSE text', () => {
    const root = makeTree({
      ...base,
      'packages/core/package.json': '{"license":"AGPL-3.0-or-later"}',
      'packages/core/LICENSE': APACHE_TEXT,
      'apps/board/package.json': '{"license":"AGPL-3.0-or-later"}',
    });
    const out = checkSpdx(root).join('\n');
    expect(out).toContain('packages/core/package.json: license AGPL-3.0-or-later does not match');
    expect(out).toContain('packages/core/LICENSE: does not match');
    expect(out).toContain('apps/board/LICENSE: missing');
  });
});
// REUSE-IgnoreEnd
