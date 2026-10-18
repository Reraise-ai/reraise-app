// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// M2 slice "Decision card, protocol and outcome" on the real stack (board, service, markdown files
// on a copy of the synthetic Hormuz store). The store already holds a decision with an open
// outcome, written in an earlier session. The board lists it in the protocol, shows all eleven
// sections, a made-up `cardsUsed` id is refused, the human enters the outcome, one linked
// experience card appears, and a reload keeps both. The files on disk are checked at the end.

import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scan } from '../support/a11y.js';
import { login, openLage } from '../support/board.js';
import { HORMUZ } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();
const DECISION_ID = '01M1F5FBW0DPQND9KSXC12WHJW';
const OUTCOME = 'E2E outcome: the tankers went via the Cape.';
const SECTION_TEXT: Record<string, string> = {
  situation: 'Night transit restrictions are announced from 1 October; Q4 cargoes are booked.',
  trigger: 'The wire report of 14 September.',
  action: 'Reroute the next three laden tankers via the Cape of Good Hope.',
  exclusions: 'No night transits while restrictions apply.',
  rationale: 'My reroute rule fires; the cost of delay outweighs the extra distance.',
  outcome: 'open',
};

async function cardFiles(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
  return Promise.all(names.map((n) => readFile(path.join(dir, n), 'utf8')));
}

test('an earlier decision is in the protocol and takes its outcome later', async ({ page }) => {
  const env = getEnv();
  const cardsDir = path.join(env.storeDir, 'cards');

  await test.step('log in, open the Lage and find the earlier decision in the protocol', async () => {
    await login(page, env);
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId(`decision-protocol-${DECISION_ID}`)).toContainText(
      'Q4 routing decision',
    );
    await expect(page.getByTestId(`decision-protocol-outcome-${DECISION_ID}`)).toHaveText('open');
  });

  await test.step('opening it shows the stored sections, and no experience card exists yet', async () => {
    await page.getByTestId(`decision-protocol-${DECISION_ID}`).getByRole('button').click();
    await expect(page.getByTestId('decision-saved')).toHaveText('Q4 routing decision');
    for (const [key, text] of Object.entries(SECTION_TEXT)) {
      await expect(page.getByTestId(`decision-section-${key}`)).toHaveText(text);
    }
    await expect(page.getByTestId('decision-section-cardsUsed')).toContainText('Coastal navy');
    await expect(page.getByTestId('decision-experience')).toHaveCount(0);
    await scan(page, 'board with an opened decision');
  });

  await test.step('a decision that names a card that does not exist is refused', async () => {
    const res = await page.request.post(`${env.serviceUrl}/decisions`, {
      headers: { 'x-worldbuilder-session': env.sessionToken },
      data: {
        format: 2,
        type: 'decision',
        title: 'E2E decision with a made-up card',
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
          cardsUsed: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
          outcome: 'open',
        },
      },
    });
    expect(res.status()).toBe(400);
  });

  await test.step('entering the outcome creates one linked experience card', async () => {
    await page.getByTestId('decision-outcome').fill(OUTCOME);
    await page.getByTestId('decision-outcome-submit').click();
    await expect(page.getByTestId('decision-experience')).toHaveText(
      'Experience: Q4 routing decision',
    );
    await expect(page.getByTestId(`decision-protocol-outcome-${DECISION_ID}`)).toHaveText(OUTCOME);
  });

  await test.step('after a reload the protocol, the sections and the experience card persist', async () => {
    await page.reload();
    await expect(page.getByTestId('lage-list')).toBeVisible();
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId(`decision-protocol-outcome-${DECISION_ID}`)).toHaveText(OUTCOME);
    await page.getByTestId(`decision-protocol-${DECISION_ID}`).getByRole('button').click();
    await expect(page.getByTestId('decision-section-situation')).toHaveText(
      SECTION_TEXT['situation']!,
    );
    await expect(page.getByTestId('decision-section-outcome')).toHaveText(OUTCOME);
    await expect(page.getByTestId('decision-experience')).toHaveText(
      'Experience: Q4 routing decision',
    );
  });

  await test.step('the files hold the outcome and exactly one experience card linked to the decision', async () => {
    const files = await cardFiles(cardsDir);
    const decision = files.find((f) => f.includes(`id: ${DECISION_ID}`))!;
    expect(decision).toContain(OUTCOME);
    expect(files.filter((f) => f.includes('Experience: Q4 routing decision'))).toHaveLength(1);
    expect(files.some((f) => f.includes('made-up card'))).toBe(false);
  });
});
