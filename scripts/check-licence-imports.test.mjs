// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkLicenceImports, importSpecifiers } from './check-licence-imports.mjs';
import { makeTree } from './test-helpers.mjs';

const pkg = (name, license, deps = {}) => JSON.stringify({ name, license, ...deps });
const base = {
  'packages/core/package.json': pkg('@wb/core', 'Apache-2.0'),
  'packages/core/src/index.ts': 'export const x = 1;\n',
  'packages/mcp-server/package.json': pkg('@wb/mcp', 'AGPL-3.0-or-later', {
    dependencies: { '@wb/core': 'workspace:*' },
  }),
  'packages/mcp-server/src/index.ts': "import { x } from '@wb/core';\n",
};

describe('importSpecifiers', () => {
  it('finds static, dynamic, side-effect and require imports', () => {
    const text = `import a from 'a';\nimport type { B } from "b";\nimport 'c';\nconst d = await import('d');\nconst e = require('e');\nexport * from './f.js';\n`;
    expect(importSpecifiers(text)).toEqual(['a', 'b', 'c', 'd', 'e', './f.js']);
  });
});

describe('checkLicenceImports', () => {
  it('passes the repository', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    expect(checkLicenceImports(root)).toEqual([]);
  });

  it('allows AGPL packages to use Apache packages', () => {
    expect(checkLicenceImports(makeTree(base))).toEqual([]);
  });

  it('reports dependencies, imports, relative paths and tsconfig paths into AGPL code', () => {
    const root = makeTree({
      ...base,
      'packages/core/package.json': pkg('@wb/core', 'Apache-2.0', {
        devDependencies: { '@wb/mcp': 'workspace:*' },
      }),
      'packages/core/src/a.ts': "import { t } from '@wb/mcp/tools';\n",
      'packages/core/src/b.ts': "export * from '../../mcp-server/src/index.js';\n",
      'packages/core/tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { tools: ['../mcp-server/src/index.ts'] } },
      }),
    });
    const out = checkLicenceImports(root).join('\n');
    expect(out).toContain('packages/core/package.json: devDependencies on AGPL package @wb/mcp');
    expect(out).toContain('packages/core/src/a.ts: imports @wb/mcp/tools');
    expect(out).toContain('packages/core/src/b.ts: imports ../../mcp-server/src/index.js');
    expect(out).toContain('packages/core/tsconfig.json: paths maps tools');
  });
});
