// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// axe-core on the main screens of the board: no serious or critical violation (WCAG 2.x A and AA
// rules plus best practices). Lower impacts are reported in the test output, not failed.

import { expect, test } from '@playwright/test';
import { scan } from '../support/a11y.js';
import { login, openLage } from '../support/board.js';
import { HORMUZ } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();

test.describe('axe on the board screens', () => {
  test('login', async ({ page }) => {
    const env = getEnv();
    await page.goto(env.boardUrl);
    await expect(page.getByTestId('login-form')).toBeVisible();
    await scan(page, 'login');
  });

  test('lagen list and usage metrics', async ({ page }) => {
    const env = getEnv();
    await login(page, env);
    await expect(page.getByTestId(`lage-item-${HORMUZ.lageId}`)).toBeVisible();
    await scan(page, 'lagen list');
    await page.getByTestId('nav-usage').click();
    await expect(page.getByTestId('usage-panel')).toBeVisible();
    await scan(page, 'usage metrics');
  });

  test('board with search, edges, proposals and context package', async ({ page }) => {
    const env = getEnv();
    await login(page, env);
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId(`card-node-${HORMUZ.wireReportId}`)).toBeVisible();
    await scan(page, 'board');

    await page.getByTestId('context-run').click();
    await expect(page.getByTestId('context-package')).toBeVisible();
    await scan(page, 'board with a context package');

    await page.getByTestId('context-target').selectOption('cloud_model');
    await page.getByTestId('context-run').click();
    await expect(page.getByTestId('context-preview')).toBeVisible();
    await scan(page, 'board with a cloud transfer preview');
  });
});
