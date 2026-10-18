// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// M2 slice "Time slider on real timestamps" on the real stack (board, service, markdown files on a
// copy of the synthetic Hormuz store). A human changes the Lage three times in the board, which
// archives three states on disk. The slider then shows each earlier board, oldest first, and the
// current one last. Moving it sends no write request and leaves every file of the store as it was
// (ADR-0049).

import { expect, test } from '@playwright/test';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { scan } from '../support/a11y.js';
import { login, openLage } from '../support/board.js';
import { HORMUZ } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();
const INITIAL_VERSION = 3; // examples/hormuz/cards/10-lage-q4-routing.md

/** Path, size and modification time of every file under `root`: any write changes this. */
async function treeStamp(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const st = await stat(full);
        out.push(`${path.relative(root, full)}:${st.size}:${st.mtimeMs}`);
      }
    }
  };
  await walk(root);
  return out.sort();
}

test('the slider shows earlier boards from the archive and saves nothing', async ({
  page,
  request,
}) => {
  const env = getEnv();
  const edgeRows = page.locator('[data-testid^="edge-row-"]');
  const archiveDir = path.join(env.storeDir, 'cards', '_archive');
  const started = Date.now() - 2_000;
  let baseEdges = 0;

  await test.step('three changes in the board archive three states', async () => {
    await login(page, env);
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION));
    await expect(page.getByTestId('time-slider')).toHaveCount(0);
    baseEdges = await edgeRows.count();

    await page.getByTestId('search-input').fill('rerouting cost');
    await page.getByTestId('search-submit').click();
    await page.getByTestId(`search-place-${HORMUZ.privateCardId}`).click();
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 1));

    await page.getByTestId('edge-kind-select').selectOption('supports');
    await page.getByTestId('edge-from').selectOption(HORMUZ.experienceCardId);
    await page.getByTestId('edge-to').selectOption(HORMUZ.privateCardId);
    await page.getByTestId('edge-add').click();
    await expect(edgeRows).toHaveCount(baseEdges + 1);
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 2));

    await page.getByTestId(`card-node-${HORMUZ.wireReportId}`).click();
    await page.getByTestId('card-remove').click();
    await expect(page.getByTestId(`card-node-${HORMUZ.wireReportId}`)).toHaveCount(0);
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 3));

    const archived = (await readdir(archiveDir)).filter((n) => n.endsWith('.md'));
    expect(archived).toHaveLength(3);
  });

  await test.step('the service lists the replaced states, oldest first, without the current one', async () => {
    const res = await request.get(`${env.serviceUrl}/lagen/${HORMUZ.lageId}/versions`, {
      headers: { 'x-worldbuilder-session': env.sessionToken },
    });
    expect(res.status()).toBe(200);
    const { versions } = (await res.json()) as {
      versions: { version: number; archivedAt: string }[];
    };
    expect(versions.map((v) => v.version)).toEqual([3, 4, 5]);
    const stamps = versions.map((v) => Date.parse(v.archivedAt));
    expect(stamps.every((t) => t >= started && t <= Date.now() + 2_000)).toBe(true);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  // A reload opens the Lage again; the archive is read when the board opens.
  await page.reload();
  await openLage(page, HORMUZ.lageId);
  const slider = page.getByTestId('time-slider');
  await expect(slider).toHaveAttribute('max', '3');
  await expect(slider).toHaveValue('3');
  await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 3));

  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(env.serviceUrl) && r.method() !== 'GET')
      writes.push(`${r.method()} ${r.url()}`);
  });
  const filesBefore = await treeStamp(env.storeDir);
  const stateBefore = await treeStamp(env.stateDir);
  const dates: string[] = [];

  const at = async (index: number, version: number) => {
    await slider.fill(String(index));
    await expect(page.getByTestId('board-version')).toHaveText(String(version));
    await expect(page.getByTestId('time-banner')).toContainText('This view is not saved');
    dates.push((await slider.getAttribute('aria-valuetext')) ?? '');
  };

  await test.step('the oldest state: the original board', async () => {
    await at(0, INITIAL_VERSION);
    await expect(page.getByTestId(`card-node-${HORMUZ.wireReportId}`)).toBeVisible();
    await expect(page.getByTestId(`card-node-${HORMUZ.privateCardId}`)).toHaveCount(0);
    await expect(edgeRows).toHaveCount(baseEdges);
    await scan(page, 'board at an earlier date');
  });

  await test.step('the next state: the private card is placed, no edge yet', async () => {
    await at(1, INITIAL_VERSION + 1);
    await expect(page.getByTestId(`card-node-${HORMUZ.privateCardId}`)).toBeVisible();
    await expect(edgeRows).toHaveCount(baseEdges);
  });

  await test.step('the third state: the edge is drawn and the removed card is still shown', async () => {
    await at(2, INITIAL_VERSION + 2);
    await expect(edgeRows).toHaveCount(baseEdges + 1);
    // The wire report left the board in the last change. It is a file, so it shows with its text.
    const node = page.getByTestId(`card-node-${HORMUZ.wireReportId}`);
    await expect(node).toBeVisible();
    await expect(node).not.toHaveAttribute('data-withheld', 'true');
  });

  await test.step('nothing can be edited while an earlier board is shown', async () => {
    await expect(page.getByTestId(`search-place-${HORMUZ.privateCardId}`)).toBeDisabled();
    await expect(page.getByTestId('edge-add')).toBeDisabled();
    await page.getByTestId(`card-node-${HORMUZ.wireReportId}`).click();
    await expect(page.getByTestId('card-remove')).toBeDisabled();
  });

  await test.step('the last position is the current board', async () => {
    await slider.fill('3');
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 3));
    await expect(page.getByTestId('time-banner')).toHaveCount(0);
    await expect(page.getByTestId(`card-node-${HORMUZ.wireReportId}`)).toHaveCount(0);
    await expect(page.getByTestId(`card-node-${HORMUZ.privateCardId}`)).toBeVisible();
  });

  await test.step('the dates run from old to new, and viewing saved nothing', async () => {
    expect(dates.every((d) => !Number.isNaN(Date.parse(d)))).toBe(true);
    expect(dates).toEqual([...dates].sort());
    expect(writes).toEqual([]);
    expect(await treeStamp(env.storeDir)).toEqual(filesBefore);
    expect(await treeStamp(env.stateDir)).toEqual(stateBefore);
    const lage = await readFile(path.join(env.storeDir, 'cards', '10-lage-q4-routing.md'), 'utf8');
    expect(lage).toMatch(new RegExp(`^version:\\s*${INITIAL_VERSION + 3}\\s*$`, 'm'));
  });
});
