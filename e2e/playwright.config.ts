// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Chromium only. The browser comes from `playwright install chromium` (run once, in CI with
// `--with-deps`) or from an existing Chromium named by PLAYWRIGHT_BROWSERS_PATH. One worker; each
// spec file starts its own stack (support/stack.ts), so no file sees what another changed.
import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: ci
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
