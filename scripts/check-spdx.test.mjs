// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { checkSpdx, expectedLicense, findSpdx } from './check-spdx.mjs';
import { makeTree } from './test-helpers.mjs';

const A = '// SPDX-License-Identifier: Apache-2.0\n// Copyright The Worldbuilder contributors\n';
const G = '// SPDX-License-Identifier: AGPL-3.0-or-later\n';

describe('expectedLicense', () => {
  it('maps tiers by directory', () => {
    expect(expectedLicense('apps/board/src/a.ts')).toBe('AGPL-3.0-or-later');
    expect(expectedLicense('services/api/src/a.ts')).toBe('AGPL-3.0-or-later');
    expect(expectedLicense('packages/mcp-server/src/a.ts')).toBe('AGPL-3.0-or-later');
    expect(expectedLicense('packages/core/src/a.ts')).toBe('Apache-2.0');
    expect(expectedLicense('scripts/a.mjs')).toBe('Apache-2.0');
  });
});

describe('findSpdx', () => {
  it('reads line and block comment headers', () => {
    expect(findSpdx(A)).toBe('Apache-2.0');
    expect(findSpdx('/* SPDX-License-Identifier: AGPL-3.0-or-later */\n')).toBe(
      'AGPL-3.0-or-later',
    );
    expect(findSpdx('const x = 1;\n')).toBeNull();
  });
});

describe('checkSpdx', () => {
  it('passes on correct headers', () => {
    const root = makeTree({
      'packages/core/src/a.ts': `${A}export {};\n`,
      'apps/board/src/a.tsx': `${G}export {};\n`,
      'apps/board/src/a.css': '/* SPDX-License-Identifier: AGPL-3.0-or-later */\n',
      'packages/core/README.md': 'no header needed\n',
      'packages/core/node_modules/x/index.js': 'ignored\n',
    });
    expect(checkSpdx(root)).toEqual([]);
  });

  it('reports missing and mismatching headers with file names', () => {
    const root = makeTree({
      'packages/core/src/missing.ts': 'export {};\n',
      'packages/core/src/wrong.ts': `${G}export {};\n`,
      'services/api/src/wrong.ts': `${A}export {};\n`,
    });
    const problems = checkSpdx(root);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toContain('packages/core/src/missing.ts: missing');
    expect(problems.join('\n')).toContain('packages/core/src/wrong.ts: SPDX AGPL-3.0-or-later');
    expect(problems.join('\n')).toContain('services/api/src/wrong.ts: SPDX Apache-2.0');
  });
});
