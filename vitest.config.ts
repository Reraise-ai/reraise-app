// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Workspace packages resolve to their sources in tests, so no build is needed first. */
const alias = Object.fromEntries(
  [
    'core',
    'conformance',
    'level1-engines',
    'disclosure-gate',
    'local-state',
    'knowledge-loop',
    'training-export',
    'adapters/storage-markdown-files',
    'mcp-server',
  ].map((dir) => [
    `@worldbuilder/${dir.replace('adapters/', '')}`,
    fileURLToPath(new URL(`./packages/${dir}/src/index.ts`, import.meta.url)),
  ]),
);

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'packages/**/src/**/*.test.ts',
            'services/**/src/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
        },
      },
      {
        resolve: {
          alias: {
            '@worldbuilder/core/outcome': fileURLToPath(
              new URL('./packages/core/src/outcome.ts', import.meta.url),
            ),
            '@worldbuilder/core/independence': fileURLToPath(
              new URL('./packages/core/src/independence.ts', import.meta.url),
            ),
            '@worldbuilder/level1-engines/format': fileURLToPath(
              new URL('./packages/level1-engines/src/format.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'board',
          environment: 'jsdom',
          include: ['apps/board/src/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/board/src/testing/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'packages/core/src/**/*.ts',
        'packages/adapters/storage-markdown-files/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        'packages/core/src/generated/**',
        'packages/adapters/storage-markdown-files/src/testing/**',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
