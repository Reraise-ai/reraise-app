// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
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
      exclude: ['**/*.test.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
