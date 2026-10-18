// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// M2 slice "Source profile and hit statistics from outcomes" on the real stack (board, service,
// markdown files on a copy of the synthetic Hormuz store, state directory on disk). The store
// holds a decision with an open outcome that cites the wire report, the coastal navy and one more
// card. The human enters the outcome on the board; each cited source gets a hit count of one. More
// outcomes follow through the service. The board shows the sample size of every dimension and
// "insufficient data" below five. The earlier profiles stay on disk and through the API.

import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { login, openLage } from '../support/board.js';
import { HORMUZ } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();
const DECISION_ID = '01M1F5FBW0DPQND9KSXC12WHJW';
const WIRE_SOURCE = 'https://example.org/wire/2026-09-14-transit-restrictions';
const OTHER_DIMENSIONS = [
  'reliability',
  'topicCompetence',
  'agreement',
  'deviation',
  'sourceQuality',
  'historicalPerformance',
  'counterPerspectiveValue',
];

interface Stored {
  profile: { minimumN: number; dimensions: { hitAccuracy: { n: number; value?: number } } };
  earlier: { dimensions: { hitAccuracy: { n: number } } }[];
}

test('an outcome adds one hit to each cited source and the earlier profiles stay', async ({
  page,
}) => {
  const env = getEnv();
  const headers = { 'x-worldbuilder-session': env.sessionToken };
  const profileUrl = `${env.serviceUrl}/source-profiles?source=${encodeURIComponent(WIRE_SOURCE)}`;
  const stored = async (): Promise<Stored> => {
    const res = await page.request.get(profileUrl, { headers });
    expect(res.status()).toBe(200);
    return (await res.json()) as Stored;
  };
  const hit = page.getByTestId('source-dimension-hitAccuracy');
  const select = async (cardId: string) => {
    await page.getByTestId(`card-node-${cardId}`).click();
    await expect(page.getByTestId('source-profile')).toBeVisible();
  };
  const decideKnown = async (title: string) => {
    const res = await page.request.post(`${env.serviceUrl}/decisions`, {
      headers,
      data: {
        format: 2,
        type: 'decision',
        title,
        sections: {
          situation: 's',
          trigger: 't',
          conditions: 'c',
          facts: 'f',
          priorities: 'p',
          action: 'a',
          alternatives: 'l',
          exclusions: 'e',
          rationale: 'r',
          cardsUsed: [HORMUZ.wireReportId],
          outcome: 'E2E outcome: it happened.',
        },
      },
    });
    expect(res.status()).toBe(201);
  };

  await test.step('before any outcome the wire report shows eight dimensions without data', async () => {
    const none = await page.request.get(profileUrl, { headers });
    expect(none.status()).toBe(404);
    await login(page, env);
    await openLage(page, HORMUZ.lageId);
    await select(HORMUZ.wireReportId);
    await expect(hit).toHaveText('Hit accuracy: insufficient data (n=0)');
    for (const id of OTHER_DIMENSIONS) {
      await expect(page.getByTestId(`source-dimension-${id}`)).toContainText(
        'insufficient data (n=0)',
      );
    }
    await expect(page.getByTestId('source-profile-earlier')).toHaveCount(0);
  });

  await test.step('the human enters the outcome of the open decision', async () => {
    await page.getByTestId(`decision-protocol-${DECISION_ID}`).getByRole('button').click();
    await page.getByTestId('decision-outcome').fill('E2E outcome: the tankers went via the Cape.');
    await page.getByTestId('decision-outcome-submit').click();
    await expect(page.getByTestId('decision-experience')).toBeVisible();
    await expect(hit).toHaveText('Hit accuracy: insufficient data (n=1)');
  });

  await test.step('the service stored one hit for the wire report and one for the navy', async () => {
    const wire = await stored();
    expect(wire.profile.dimensions.hitAccuracy.n).toBe(1);
    expect(wire.profile.minimumN).toBe(5);
    expect(wire.earlier).toEqual([]);
    const navy = await page.request.get(
      `${env.serviceUrl}/source-profiles?source=${HORMUZ.navyCardId}`,
      { headers },
    );
    expect(((await navy.json()) as Stored).profile.dimensions.hitAccuracy.n).toBe(1);
  });

  await test.step('the board shows the sample size and still says insufficient data', async () => {
    await page.reload();
    await openLage(page, HORMUZ.lageId);
    await select(HORMUZ.wireReportId);
    await expect(hit).toHaveText('Hit accuracy: insufficient data (n=1)');
    await select(HORMUZ.navyCardId);
    await expect(hit).toHaveText('Hit accuracy: insufficient data (n=1)');
  });

  await test.step('three more outcomes make four hits, still below the minimum', async () => {
    for (const title of ['E2E second', 'E2E third', 'E2E fourth']) await decideKnown(title);
    await page.reload();
    await openLage(page, HORMUZ.lageId);
    await select(HORMUZ.wireReportId);
    await expect(hit).toHaveText('Hit accuracy: insufficient data (n=4)');
    await expect(page.getByTestId('source-profile-earlier')).toHaveText('Earlier hit count: 3');
  });

  await test.step('the fifth outcome reaches the minimum and the figure appears with its n', async () => {
    await decideKnown('E2E fifth');
    await page.reload();
    await openLage(page, HORMUZ.lageId);
    await select(HORMUZ.wireReportId);
    await expect(hit).toHaveText('Hit accuracy: 1 (n=5)');
    await expect(page.getByTestId('source-profile-earlier')).toHaveText('Earlier hit count: 4');
    for (const id of OTHER_DIMENSIONS) {
      await expect(page.getByTestId(`source-dimension-${id}`)).toContainText(
        'insufficient data (n=0)',
      );
    }
    expect(await page.getByTestId('source-profile').textContent()).not.toMatch(
      /%|percent|verdict|\bscore\b/i,
    );
  });

  await test.step('every earlier state is still there through the API and on disk', async () => {
    const now = await stored();
    expect(now.profile.dimensions.hitAccuracy.n).toBe(5);
    expect(now.earlier.map((p) => p.dimensions.hitAccuracy.n)).toEqual([1, 2, 3, 4]);
    const dir = path.join(env.stateDir, 'source-profiles');
    const files = await readdir(dir);
    const onDisk = await Promise.all(files.map((f) => readFile(path.join(dir, f), 'utf8')));
    const wireFile = onDisk.map((t) => JSON.parse(t) as Stored & { profile: { source: string } });
    const wire = wireFile.find((p) => p.profile.source === WIRE_SOURCE)!;
    expect(wire.earlier.map((p) => p.dimensions.hitAccuracy.n)).toEqual([1, 2, 3, 4]);
    const cards = (await readdir(path.join(env.storeDir, 'cards'))).filter((n) =>
      n.endsWith('.md'),
    );
    const texts = await Promise.all(
      cards.map((n) => readFile(path.join(env.storeDir, 'cards', n), 'utf8')),
    );
    expect(texts.some((t) => t.includes('hitAccuracy'))).toBe(false);
  });
});
