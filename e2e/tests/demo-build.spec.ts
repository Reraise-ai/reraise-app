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

  test('embedded (?embed=1): no demo notice or Sign out, the host theme, cards apart and centred', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`${base}/board/?embed=1&theme=light`);
    await expect(page.getByTestId(`lage-item-${HORMUZ.lageId}`)).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await expect(page.getByTestId('session-signout')).toHaveCount(0);
    await expect(page.locator('.wb-shell')).toHaveAttribute('data-wb-theme', 'light');

    await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
    await expect(page.getByTestId(`card-node-${HORMUZ.experienceCardId}`)).toBeVisible();
    // A host that sizes its window after the board opened (Hermes: a large empty band above
    // the cards). The canvas fits the cards again because nobody has panned or zoomed yet.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => page.evaluate(layout).then((l) => l.offCentre)).toBeLessThan(24);
    const l = await page.evaluate(layout);
    expect(l.overlaps).toEqual([]);
    expect(l.badgeContrast).toBeGreaterThanOrEqual(4.5);
  });
});

/** Card overlaps, how far the cards sit off the vertical centre, and the Experience badge contrast. */
function layout() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'));
  const boxes = nodes.map((n) => [n.dataset['id'] ?? '', n.getBoundingClientRect()] as const);
  const overlaps: string[] = [];
  boxes.forEach(([ida, a], i) =>
    boxes.slice(i + 1).forEach(([idb, b]) => {
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
        overlaps.push(`${ida} / ${idb}`);
    }),
  );
  const pane = document.querySelector('.react-flow')!.getBoundingClientRect();
  const top = Math.min(...boxes.map(([, r]) => r.top)) - pane.top;
  const bottom = pane.bottom - Math.max(...boxes.map(([, r]) => r.bottom));
  const badge = document.querySelector<HTMLElement>('.wb-badge[data-kind="experience"]')!;
  const rgb = (el: Element, prop: 'color' | 'backgroundColor') =>
    (getComputedStyle(el)[prop].match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = ([r, g, b]: number[]) => {
    const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  const fg = lum(rgb(badge, 'color'));
  const bg = lum(rgb(badge.closest('.wb-card')!, 'backgroundColor'));
  const badgeContrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  return { overlaps, offCentre: Math.abs(top - bottom), badgeContrast };
}

async function expectNoStance(context: BrowserContext, url: string): Promise<void> {
  const page: Page = await context.newPage();
  await page.goto(url);
  await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
  await expect(page.getByTestId(`card-stance-${HORMUZ.wireReportId}`)).toHaveCount(0);
}
