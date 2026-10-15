// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The static demo build: /board/ loads with no Board API. An edit stays in this browser
// and is absent from a second browser.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HORMUZ } from '../support/env.js';
import { serveDemo } from '../support/demoServer.js';

const demoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'board',
  'dist',
  'demo',
);

test.describe('static demo build', () => {
  let base: string;
  let close: (() => Promise<void>) | undefined;

  test.beforeAll(async () => {
    if (!existsSync(path.join(demoDir, 'index.html'))) {
      throw new Error('The demo build is missing. Run `pnpm build:demo` first.');
    }
    const started = await serveDemo(demoDir);
    base = `http://127.0.0.1:${started.port}`;
    close = () =>
      new Promise((resolve, reject) =>
        started.server.close((err) => (err ? reject(err) : resolve())),
      );
  });

  test.afterAll(async () => {
    await close?.();
  });

  test('opens Hormuz under /board/ and keeps a stance in this browser only', async ({
    page,
    browser,
  }) => {
    const foreign: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).origin !== base) foreign.push(req.url());
    });

    await page.goto(`${base}/board/`);
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('login-form')).toHaveCount(0);
    await expect(page.getByTestId(`lage-item-${HORMUZ.lageId}`)).toBeVisible();
    await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
    await expect(page.getByTestId('board-title')).toHaveText('Q4 tanker routing');
    await page.getByTestId(`card-node-${HORMUZ.wireReportId}`).click();
    await page.getByTestId('stance-position').selectOption('believed');
    await page.getByTestId('stance-note').fill('demo local note');
    await page.getByTestId('stance-save').click();
    await expect(page.getByTestId(`card-stance-${HORMUZ.wireReportId}`)).toHaveText(
      'You: believed, weight 2',
    );

    await page.reload();
    await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
    await expect(page.getByTestId(`card-stance-${HORMUZ.wireReportId}`)).toHaveText(
      'You: believed, weight 2',
    );

    const other = await browser.newContext();
    try {
      await expectNoStance(other, `${base}/board/`);
    } finally {
      await other.close();
    }

    await page.getByTestId('session-signout').click();
    await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
    await expect(page.getByTestId(`card-stance-${HORMUZ.wireReportId}`)).toHaveCount(0);
    expect(foreign).toEqual([]);
  });
});

async function expectNoStance(context: BrowserContext, url: string): Promise<void> {
  const page: Page = await context.newPage();
  await page.goto(url);
  await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
  await expect(page.getByTestId(`card-stance-${HORMUZ.wireReportId}`)).toHaveCount(0);
}
