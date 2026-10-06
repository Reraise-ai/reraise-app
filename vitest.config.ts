// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Workspace packages resolve to their sources in tests, so no build is needed first. */
const alias = Object.fromEntries(
  ['core', 'conformance', 'disclosure-gate', 'local-state'].map((name) => [
    `@worldbuilder/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
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
        test: {
          name: 'board',
          environment: 'jsdom',
          include: ['apps/board/src/**/*.test.{ts,tsx}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/core/src/generated/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
