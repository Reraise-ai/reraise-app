// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// M2 slice "Rules panel replacing the barometer" on the real stack (board, service, markdown files
// on a copy of the synthetic Hormuz store). The two rule cards of the example are read from the
// store and listed as fired or not fired with their own text and the triggering card; nothing on
// the board is a meter or a percentage. A card or a rule that an agent only proposed does not fire
// or appear until the human accepts it. The human writes a rule through the board form and changes
// its action; the next evaluation, also after a reload, reads exactly that stored card. The API
// takes every condition kind. The files on disk are checked at the end.

import { expect, test, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scan } from '../support/a11y.js';
import { connectAgent, type ScriptedAgent } from '../support/agent.js';
import { login, openLage } from '../support/board.js';
import { HORMUZ } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();
const REROUTE_RULE = '01M1EV5S00YXKKGEG772AZM7P9'; // examples/hormuz/cards/08-rule-reroute-on-evidenced-closure.md
const STANCE_RULE = '01M1EYKMM0PW82HRM7RY5175E7'; // examples/hormuz/cards/09-rule-delay-if-i-believe-extension.md
const PROPOSER_SYSTEM = 'E2E proposer system';
const PROPOSED_CARD = 'E2E proposed claim';
const PROPOSED_RULE_TEXT = 'E2E proposed rule action';
const OWN_TITLE = 'E2E hold rule';
const FIRST_ACTION = 'E2E hold the course';
const CHANGED_ACTION = 'E2E divert via the Cape';

interface Proposal {
  id: string;
  status: string;
}

const row = (page: Page, ruleId: string) => page.getByTestId(`rules-row-${ruleId}`);
const rulesPanel = (page: Page) => page.getByTestId('rules-panel');

async function ruleFiles(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
  const files = await Promise.all(names.map((n) => readFile(path.join(dir, n), 'utf8')));
  return files.filter((f) => /^type: rule$/m.test(f));
}

let agent: ScriptedAgent | undefined;
test.afterEach(async () => {
  await agent?.close().catch(() => undefined);
});

test('the rules panel lists the stored rules and the human changes one', async ({ page }) => {
  const env = getEnv();
  const cardsDir = path.join(env.storeDir, 'cards');
  const headers = { 'x-worldbuilder-session': env.sessionToken };

  await test.step('the stored rule cards are listed as fired and not fired, with no verdict', async () => {
    await login(page, env);
    await openLage(page, HORMUZ.lageId);
    await expect(rulesPanel(page)).toBeVisible();
    await expect(row(page, REROUTE_RULE)).toHaveAttribute('data-fired', 'true');
    await expect(page.getByTestId(`rules-fired-${REROUTE_RULE}`)).toHaveText('Fired');
    await expect(page.getByTestId(`rules-then-${REROUTE_RULE}`)).toHaveText(
      'Reroute laden tankers via the Cape of Good Hope',
    );
    await expect(
      page.getByTestId(`rules-trigger-${REROUTE_RULE}-${HORMUZ.wireReportId}`),
    ).toBeVisible();
    await expect(row(page, STANCE_RULE)).toHaveAttribute('data-fired', 'false');
    await expect(page.getByTestId(`rules-fired-${STANCE_RULE}`)).toHaveText('Not fired');
    await expect(page.getByTestId(`rules-then-${STANCE_RULE}`)).toHaveText(
      'Delay sailings by two weeks',
    );
    // The barometer is gone: no meter element, no percentage, no recommendation anywhere.
    await expect(page.locator('meter, progress, [role="meter"], [role="progressbar"]')).toHaveCount(
      0,
    );
    await expect(page.getByTestId('workbench')).not.toContainText(
      /%|percent|barometer|verdict|recommend|winning/i,
    );
    await scan(page, 'board with the rules panel');
  });

  await test.step('a pending proposed card fires no rule and a pending proposed rule is not listed', async () => {
    const own = await page.request.post(`${env.serviceUrl}/rules`, {
      headers,
      data: {
        title: 'E2E rule on the proposer system',
        rule: {
          when: [{ kind: 'card_field', field: 'originSystem', equals: PROPOSER_SYSTEM }],
          then: 'E2E proposer rule action',
        },
      },
    });
    expect(own.status()).toBe(201);
    const watchedId = ((await own.json()) as { id: string }).id;

    agent = await connectAgent(env.serviceUrl, env.agents.local.tokenFile);
    const cardProposal = await agent.call<Proposal>('proposal_create', {
      kind: 'create_card',
      payload: {
        card: {
          format: 2,
          type: 'claim',
          title: PROPOSED_CARD,
          layer: 'said',
          originSystem: PROPOSER_SYSTEM,
          body: 'An invented claim for the rules panel test.',
        },
        lageId: HORMUZ.lageId,
        x: 720,
        y: 300,
      },
    });
    const ruleProposal = await agent.call<Proposal>('proposal_create', {
      kind: 'create_card',
      payload: {
        card: {
          format: 2,
          type: 'rule',
          title: 'E2E proposed rule',
          rule: {
            when: [{ kind: 'card_on_lage', card: HORMUZ.wireReportId }],
            then: PROPOSED_RULE_TEXT,
          },
        },
      },
    });
    expect([cardProposal.status, ruleProposal.status]).toEqual(['pending', 'pending']);

    // Both proposals reach the board by polling; the rules panel is read after that.
    await expect(page.getByTestId(`proposal-${cardProposal.id}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`proposal-${ruleProposal.id}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('lage-list')).toBeVisible();
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId(`rules-row-${watchedId}`)).toHaveAttribute('data-fired', 'false');
    await expect(rulesPanel(page)).not.toContainText(PROPOSED_RULE_TEXT);
    await expect(rulesPanel(page)).not.toContainText(PROPOSED_CARD);
    const evaluated = await page.request.post(`${env.serviceUrl}/rules/evaluate`, {
      headers,
      data: { lageId: HORMUZ.lageId },
    });
    expect(JSON.stringify(await evaluated.json())).not.toContain(PROPOSED_RULE_TEXT);

    await test.step('after the human accepts the card the rule on it fires, with that card as trigger', async () => {
      await page.getByTestId(`proposal-accept-${cardProposal.id}`).click();
      await expect(page.getByTestId(`proposal-${cardProposal.id}`)).toHaveAttribute(
        'data-status',
        'accepted',
      );
      await expect(page.getByTestId(`rules-row-${watchedId}`)).toHaveAttribute(
        'data-fired',
        'true',
      );
      await expect(rulesPanel(page).getByRole('button', { name: PROPOSED_CARD })).toBeVisible();
    });

    await test.step('after the human accepts the rule card it is listed', async () => {
      await page.getByTestId(`proposal-accept-${ruleProposal.id}`).click();
      await expect(page.getByTestId(`proposal-${ruleProposal.id}`)).toHaveAttribute(
        'data-status',
        'accepted',
      );
      await page.reload();
      await expect(page.getByTestId('lage-list')).toBeVisible();
      await openLage(page, HORMUZ.lageId);
      await expect(rulesPanel(page)).toContainText(PROPOSED_RULE_TEXT);
    });
  });

  await test.step('the human writes a rule through the form; the next evaluation reads it', async () => {
    await page.getByTestId('rule-title').fill(OWN_TITLE);
    await page.getByTestId('rule-when').selectOption(HORMUZ.wireReportId);
    await page.getByTestId('rule-then').fill(FIRST_ACTION);
    await page.getByTestId('rule-create-submit').click();
    const created = page.locator('[data-testid^="rules-row-"]', { hasText: FIRST_ACTION });
    await expect(created).toHaveCount(1);
    await expect(created).toHaveAttribute('data-fired', 'true');
  });

  await test.step('the human changes its action; the panel shows the stored change', async () => {
    const created = page.locator('[data-testid^="rules-row-"]', { hasText: FIRST_ACTION });
    await created.getByRole('button', { name: 'Change' }).click();
    await page.getByTestId('rule-edit-then').fill(CHANGED_ACTION);
    await page.getByTestId('rule-edit-submit').click();
    await expect(
      page.locator('[data-testid^="rules-row-"]', { hasText: CHANGED_ACTION }),
    ).toHaveCount(1);
    await expect(rulesPanel(page)).not.toContainText(FIRST_ACTION);
  });

  await test.step('after a reload the changed action is what the evaluation returns', async () => {
    await page.reload();
    await expect(page.getByTestId('lage-list')).toBeVisible();
    await openLage(page, HORMUZ.lageId);
    const changed = page.locator('[data-testid^="rules-row-"]', { hasText: CHANGED_ACTION });
    await expect(changed).toHaveCount(1);
    await expect(changed).toHaveAttribute('data-fired', 'true');
    await expect(rulesPanel(page)).not.toContainText(FIRST_ACTION);
    await scan(page, 'board with the changed rule');
  });

  await test.step('the API accepts every condition kind', async () => {
    const conditions = [
      { kind: 'card_on_lage', card: HORMUZ.wireReportId },
      { kind: 'card_field', field: 'layer', equals: 'evidenced' },
      { kind: 'tag', tag: 'e2e-tag' },
      { kind: 'edge', edgeKind: 'represents' },
      { kind: 'stance', card: HORMUZ.navyCardId, position: 'believed' },
    ];
    for (const condition of conditions) {
      const res = await page.request.post(`${env.serviceUrl}/rules`, {
        headers,
        data: { title: `E2E ${condition.kind} rule`, rule: { when: [condition], then: 'x' } },
      });
      expect(res.status(), condition.kind).toBe(201);
    }
    const bad = await page.request.post(`${env.serviceUrl}/rules`, {
      headers,
      data: { title: 'E2E unknown kind', rule: { when: [{ kind: 'percentage' }], then: 'x' } },
    });
    expect(bad.status()).toBe(400);
  });

  await test.step('the files hold the changed action once, the first action never, and no proposal', async () => {
    const files = await ruleFiles(cardsDir);
    const own = files.filter((f) => f.includes(`title: ${OWN_TITLE}`));
    expect(own).toHaveLength(1);
    expect(own[0]).toContain(CHANGED_ACTION);
    expect(files.some((f) => f.includes(FIRST_ACTION))).toBe(false);
    for (const kind of ['card_on_lage', 'card_field', 'tag', 'edge', 'stance']) {
      expect(files.filter((f) => f.includes(`title: E2E ${kind} rule`))).toHaveLength(1);
    }
    expect(files.some((f) => f.includes('E2E unknown kind'))).toBe(false);
  });
});
