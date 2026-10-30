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

  test('embedded (?embed=1): no demo notice or Sign out, the host theme, cards apart and at the top', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`${base}/board/?embed=1&theme=light`);
    await expect(page.getByTestId(`lage-item-${HORMUZ.lageId}`)).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await expect(page.getByTestId('session-signout')).toHaveCount(0);
    await expect(page.locator('.wb-theme')).toHaveAttribute('data-wb-theme', 'light');

    await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
    await expect(page.getByTestId(`card-node-${HORMUZ.experienceCardId}`)).toBeVisible();
    // A host that sizes its window after the board opened (Hermes: a large empty band above
    // the cards). The canvas fits the cards again because nobody has panned or zoomed yet.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => page.evaluate(layout).then((l) => l.emptyAbove)).toBeLessThan(40);
    const l = await page.evaluate(layout);
    expect(l.overlaps).toEqual([]);
    expect(l.badgeContrast).toBeGreaterThanOrEqual(4.5);

    // A zoom with the + button is the user's: the next resize keeps it.
    const viewport = page.locator('.react-flow__viewport');
    const fitted = await viewport.getAttribute('style');
    await page.locator('.react-flow__controls-zoomin').click();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(fitted);
    await page.waitForTimeout(300);
    const zoomed = await viewport.getAttribute('style');
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);
    await expect(viewport).toHaveAttribute('style', zoomed!);
  });

  test('the board starts at the top, under 40 px empty above it, beside a long sidebar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/board/?embed=1&theme=light`);
    // A host box like the Hermes desktop plugin: a fixed-height area that scrolls on its own.
    await page.evaluate(() => {
      const root = document.getElementById('root')!;
      const host = document.createElement('div');
      host.setAttribute('style', 'position:fixed;inset:48px 0 0 300px;overflow:auto');
      root.replaceWith(host);
      host.append(root);
    });
    await page.addStyleTag({
      content: '.wb-sidebar::after{content:"";display:block;height:2400px}',
    });
    await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
    await expect(page.getByTestId(`card-node-${HORMUZ.experienceCardId}`)).toBeVisible();
    await expect.poll(() => page.evaluate(layout).then((l) => l.emptyAbove)).toBeLessThan(40);
    const l = await page.evaluate(layout);
    expect(l.overlaps).toEqual([]);
    // The canvas ends inside the window: it is not as high as the sidebar.
    expect(l.paneBottom).toBeLessThanOrEqual(900);
    expect(l.sidebarScroll).toBeGreaterThan(2400);
  });

  test('in a host without a fixed height the canvas stays within the window beside a long sidebar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/board/?embed=1&theme=light`);
    // A host box that grows with its content: the page itself scrolls.
    await page.evaluate(() => {
      const root = document.getElementById('root')!;
      const host = document.createElement('div');
      host.setAttribute('style', 'margin:48px 0 0 300px');
      root.replaceWith(host);
      host.append(root);
    });
    await page.addStyleTag({
      content: '.wb-sidebar::after{content:"";display:block;height:2400px}',
    });
    await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
    await expect(page.getByTestId(`card-node-${HORMUZ.experienceCardId}`)).toBeVisible();
    const pane = () =>
      page.evaluate(() => {
        const r = document.querySelector('.react-flow')!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      });
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(2400);
    // Not higher than the window; once the page scrolls, it sits fully in view.
    const before = await pane();
    expect(before.height).toBeGreaterThan(300);
    expect(before.height).toBeLessThanOrEqual(900);
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => pane().then((p) => p.top)).toBeGreaterThanOrEqual(0);
    const after = await pane();
    expect(after.bottom).toBeLessThanOrEqual(900);
    expect(after.height).toBeGreaterThan(300);
  });
});

/** Card overlaps, the empty band above the cards, and the Experience badge contrast. */
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
  // From the status line above the canvas (or the canvas top) down to the highest card.
  const status = document.querySelector('[data-testid="board-status"]')!.getBoundingClientRect();
  const emptyAbove = Math.min(...boxes.map(([, r]) => r.top)) - Math.max(pane.top, status.bottom);
  const sidebarScroll = document.querySelector('.wb-sidebar')!.scrollHeight;
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
  return { overlaps, emptyAbove, paneBottom: pane.bottom, sidebarScroll, badgeContrast };
}

async function expectNoStance(context: BrowserContext, url: string): Promise<void> {
  const page: Page = await context.newPage();
  await page.goto(url);
  await page.getByTestId(`lage-open-${HORMUZ.lageId}`).click();
  await expect(page.getByTestId(`card-stance-${HORMUZ.wireReportId}`)).toHaveCount(0);
}
