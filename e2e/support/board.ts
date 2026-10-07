// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { expect, type Page } from '@playwright/test';
import type { E2eEnv } from './env.js';

/** Logs in on the login form with the human session token. */
export async function login(page: Page, env: E2eEnv): Promise<void> {
  await page.goto(env.boardUrl);
  await expect(page.getByTestId('login-form')).toBeVisible();
  await page.getByTestId('login-base-url').fill(env.serviceUrl);
  await page.getByTestId('login-token').fill(env.sessionToken);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('lage-list')).toBeVisible();
}

/** Opens a Lage from the list and waits until its canvas shows the cards. */
export async function openLage(page: Page, lageId: string): Promise<void> {
  await page.getByTestId(`lage-open-${lageId}`).click();
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
}
