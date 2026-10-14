// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/board/' : '/',
  // The seed file sits next to this outDir. A production build empties `dist` and does not
  // see it. `pnpm build:demo` writes the seed after that, then builds into `dist/demo`.
  ...(mode === 'demo'
    ? { publicDir: 'dist/demo-seed', build: { outDir: 'dist/demo', emptyOutDir: true } }
    : {}),
  plugins: [react()],
  resolve: {
    alias: {
      // Pure helpers only. The board typechecks against the generated contracts, not the core
      // package index, so these files are named on their own.
      '@worldbuilder/core/outcome': fileURLToPath(
        new URL('../../packages/core/src/outcome.ts', import.meta.url),
      ),
      '@worldbuilder/core/independence': fileURLToPath(
        new URL('../../packages/core/src/independence.ts', import.meta.url),
      ),
      '@worldbuilder/core/source-profile': fileURLToPath(
        new URL('../../packages/core/src/source-profile.ts', import.meta.url),
      ),
      '@worldbuilder/core/theme': fileURLToPath(
        new URL('../../packages/core/src/theme.ts', import.meta.url),
      ),
      '@worldbuilder/core/ids': fileURLToPath(
        new URL('../../packages/core/src/ids.ts', import.meta.url),
      ),
      // Only the display formatter of the level-1 package (pure text, no runtime imports): the
      // board shows exactly the text of the contract and does not bundle the engines.
      '@worldbuilder/level1-engines/format': fileURLToPath(
        new URL('../../packages/level1-engines/src/format.ts', import.meta.url),
      ),
    },
  },
}));
