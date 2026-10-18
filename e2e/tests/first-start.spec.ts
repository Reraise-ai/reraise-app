// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The newcomer path: `serve --init` on a folder that does not exist yet, then the URL and the
// session token the service prints, and nothing else: no second server, no --allow-origin, no
// service address to type. The board comes from the service itself and opens an empty world.

import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freePort, startService, stop_ } from '../support/stack.js';

test.describe('first start', () => {
  let work: string;
  let service: { child: ChildProcess; log: () => string } | undefined;

  test.beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'wb-e2e-first-'));
    service = await startService([
      '--init',
      '--store',
      path.join(work, 'my-world'),
      '--state',
      path.join(work, 'state'),
      '--port',
      String(await freePort()),
    ]);
  });

  test.afterAll(async () => {
    if (service) await stop_(service.child);
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test('the printed URL opens the board, the printed token signs in, the world is empty', async ({
    page,
  }) => {
    const line = /Session token: (\S+) {2}Open (http:\/\/\S+) in your browser/.exec(service!.log());
    expect(line, service!.log()).not.toBeNull();
    const [, token, url] = line!;
    await page.goto(url!);
    await expect(page.getByTestId('login-base-url')).toHaveValue(url!);
    await page.getByTestId('login-token').fill(token!);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('lage-list')).toContainText('No Lage yet');

    await page.getByTestId('lage-create-title').fill('First board');
    await page.getByTestId('lage-create-question').fill('What do I decide first?');
    await page.getByTestId('lage-create-submit').click();
    await expect(page.getByTestId('workbench')).toBeVisible();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
  });
});
