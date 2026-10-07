// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Only the display formatter of the level-1 package (pure text, no runtime imports): the
      // board shows exactly the text of the contract and does not bundle the engines.
      '@worldbuilder/level1-engines/format': fileURLToPath(
        new URL('../../packages/level1-engines/src/format.ts', import.meta.url),
      ),
    },
  },
});
