// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// M2 slice "Player fields with provenance" on the real stack (board, service, MCP, markdown files
// on a copy of the synthetic Hormuz store). The board shows the source pass, "N findings · M
// origins", on each placed card, on an actor's seat entries and its moves, on each edge and on the
// cards a decision uses. A scripted agent proposes seats over MCP: an entry without a source is
// refused for every player field and nothing is stored; an empty player field is accepted, and the
// human sees it on the board as 0 findings. The files on disk are checked at the end.

import { expect, test, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scan } from '../support/a11y.js';
import { connectAgent, type ScriptedAgent } from '../support/agent.js';
import { login, openLage } from '../support/board.js';
import { HORMUZ } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();
const NEWSPAPER_ID = '01M1E6JK80GR8G0JHMPVT7TDX4';
const BROADCASTER_ID = '01M1EA0EW0V90F04X7AKQJSKK2';
const CONSORTIUM_ID = '01M1EGW640BMD0RDT5NGRMFD70';
const DECISION_ID = '01M1F5FBW0DPQND9KSXC12WHJW';
const FIELDS = ['interests', 'capabilities', 'dependencies', 'moves'] as const;

interface Proposal {
  id: string;
  status: string;
}

const seat = (title: string, extra: Record<string, unknown>) => ({
  format: 2,
  collection: 'actors',
  type: 'organisation',
  title,
  layer: 'said',
  originSystem: 'E2E seat system',
  ...extra,
});

const select = async (page: Page, cardId: string) => {
  await page.getByTestId(`card-node-${cardId}`).click();
  await expect(page.getByTestId('inspector-title')).toBeVisible();
};

async function cardTexts(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
  return Promise.all(names.map((n) => readFile(path.join(dir, n), 'utf8')));
}

let agent: ScriptedAgent | undefined;
test.afterEach(async () => {
  await agent?.close().catch(() => undefined);
});

test('the board shows the source pass and the service refuses an unsourced player entry', async ({
  page,
}) => {
  const env = getEnv();
  const cardsDir = path.join(env.storeDir, 'cards');
  const passOf = (cardId: string) => page.getByTestId(`card-source-pass-${cardId}`);

  await test.step('every placed card carries its pass; a copy chain is one origin', async () => {
    await login(page, env);
    await openLage(page, HORMUZ.lageId);
    // wire report, newspaper (cites it) and broadcaster (based on the newspaper): three findings, one origin
    for (const id of [HORMUZ.wireReportId, NEWSPAPER_ID, BROADCASTER_ID]) {
      await expect(passOf(id)).toHaveText('3 findings · 1 origin');
    }
    for (const id of [HORMUZ.navyCardId, CONSORTIUM_ID, HORMUZ.experienceCardId]) {
      await expect(passOf(id)).toHaveText('1 finding · 1 origin');
    }
  });

  await test.step('an actor shows the pass of its seat entries and of its moves', async () => {
    await select(page, HORMUZ.navyCardId);
    await expect(page.getByTestId('card-source-pass')).toHaveText('1 finding · 1 origin');
    // interest and move cite the wire report (one origin), capability and dependency two web pages
    await expect(page.getByTestId('seat-source-pass')).toHaveText('4 findings · 3 origins');
    await expect(page.getByTestId('moves-source-pass')).toHaveText('1 finding · 1 origin');
    await expect(page.getByTestId('seat-entries')).toContainText(
      `Move: Announced night transit restrictions (${HORMUZ.wireReportId})`,
    );
  });

  await test.step('an actor without moves is allowed and shows 0 findings', async () => {
    await select(page, CONSORTIUM_ID);
    await expect(page.getByTestId('seat-source-pass')).toHaveText('1 finding · 1 origin');
    await expect(page.getByTestId('moves-source-pass')).toHaveText('0 findings · 0 origins');
    await select(page, HORMUZ.wireReportId);
    await expect(page.getByTestId('seat-pass')).toHaveCount(0);
  });

  await test.step('an edge shows the pass of its two cards; two copies are one origin', async () => {
    await expect(
      page.getByTestId(`edge-source-pass-${HORMUZ.navyCardId}>${HORMUZ.wireReportId}:represents`),
    ).toHaveText('2 findings · 2 origins');
    await page.getByTestId('edge-kind-select').selectOption('supports');
    await page.getByTestId('edge-from').selectOption(NEWSPAPER_ID);
    await page.getByTestId('edge-to').selectOption(HORMUZ.wireReportId);
    await page.getByTestId('edge-add').click();
    await expect(
      page.getByTestId(`edge-source-pass-${NEWSPAPER_ID}>${HORMUZ.wireReportId}:supports`),
    ).toHaveText('2 findings · 1 origin');
  });

  await test.step('a decision shows the pass of the cards it uses, new and stored', async () => {
    await expect(page.getByTestId('decision-source-pass')).toHaveText('0 findings · 0 origins');
    for (const id of [HORMUZ.wireReportId, NEWSPAPER_ID, BROADCASTER_ID]) {
      await page.getByTestId(`decision-card-${id}`).check();
    }
    await expect(page.getByTestId('decision-source-pass')).toHaveText('3 findings · 1 origin');
    await page.getByTestId(`decision-card-${HORMUZ.navyCardId}`).check();
    await expect(page.getByTestId('decision-source-pass')).toHaveText('4 findings · 2 origins');
    // The stored decision uses the wire report, the navy and the insurance experience.
    await page.getByTestId(`decision-protocol-${DECISION_ID}`).getByRole('button').click();
    await expect(page.getByTestId('decision-saved')).toHaveText('Q4 routing decision');
    await expect(page.getByTestId('decision-source-pass')).toHaveText('3 findings · 3 origins');
    await scan(page, 'board with source passes');
  });

  agent = await connectAgent(env.serviceUrl, env.agents.local.tokenFile);
  const scripted = agent;
  const pending = async () =>
    (await scripted.call<{ proposals: Proposal[] }>('proposal_list', { status: 'pending' }))
      .proposals;
  let filesBefore: string[] = [];
  let pendingBefore = 0;

  await test.step('an entry without a source is refused for every player field, and nothing is stored', async () => {
    filesBefore = (await readdir(cardsDir)).sort();
    pendingBefore = (await pending()).length;
    for (const field of FIELDS) {
      for (const entry of [
        { text: `E2E unsourced ${field}` },
        { text: 'Empty source', source: '' },
      ]) {
        await expect(
          scripted.call('proposal_create', {
            kind: 'create_card',
            payload: { card: seat(`E2E unsourced ${field}`, { [field]: [entry] }) },
          }),
          `${field} ${JSON.stringify(entry)}`,
        ).rejects.toThrow(/source/);
      }
    }
    expect(await pending()).toHaveLength(pendingBefore);
    expect((await readdir(cardsDir)).sort()).toEqual(filesBefore);
  });

  let emptySeat!: Proposal;
  let sourcedSeat!: Proposal;
  await test.step('an empty player field and a sourced seat are accepted as proposals', async () => {
    emptySeat = await scripted.call<Proposal>('proposal_create', {
      kind: 'create_card',
      payload: {
        card: seat('E2E empty seat', { interests: [], moves: [] }),
        lageId: HORMUZ.lageId,
        x: 120,
        y: 120,
      },
    });
    sourcedSeat = await scripted.call<Proposal>('proposal_create', {
      kind: 'create_card',
      payload: {
        card: seat('E2E sourced seat', {
          interests: [{ text: 'E2E keep the lane open', source: HORMUZ.wireReportId }],
          moves: [
            { text: 'E2E repeat the announcement', source: HORMUZ.wireReportId },
            { text: 'E2E send an escort', source: 'https://example.org/e2e/escort' },
          ],
        }),
        lageId: HORMUZ.lageId,
        x: 700,
        y: 120,
      },
    });
    expect([emptySeat.status, sourcedSeat.status]).toEqual(['pending', 'pending']);
  });

  await test.step('the human accepts both; the board shows the empty seat as 0 findings', async () => {
    await expect(page.getByTestId(`proposal-${emptySeat.id}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`proposal-${sourcedSeat.id}`)).toBeVisible();
    for (const p of [emptySeat, sourcedSeat]) {
      await page.getByTestId(`proposal-accept-${p.id}`).click();
      await expect(page.getByTestId(`proposal-${p.id}`)).toHaveAttribute('data-status', 'accepted');
    }
    await page.reload();
    await expect(page.getByTestId('lage-list')).toBeVisible();
    await openLage(page, HORMUZ.lageId);
    const nodes = page.locator('[data-testid^="card-node-"]');
    const byTitle = (title: string) => nodes.filter({ hasText: title });
    await byTitle('E2E empty seat').click();
    await expect(page.getByTestId('inspector-title')).toHaveText('E2E empty seat');
    await expect(page.getByTestId('seat-source-pass')).toHaveText('0 findings · 0 origins');
    await expect(page.getByTestId('moves-source-pass')).toHaveText('0 findings · 0 origins');
    await expect(page.getByTestId('seat-entries')).toHaveCount(0);
    await byTitle('E2E sourced seat').click();
    await expect(page.getByTestId('inspector-title')).toHaveText('E2E sourced seat');
    await expect(page.getByTestId('seat-source-pass')).toHaveText('3 findings · 2 origins');
    await expect(page.getByTestId('moves-source-pass')).toHaveText('2 findings · 2 origins');
    await scan(page, 'board with a sourced seat');
  });

  await test.step('on disk: both accepted seats are there, no unsourced one, nothing else new', async () => {
    const texts = await cardTexts(cardsDir);
    expect(texts.some((t) => t.includes('title: E2E empty seat'))).toBe(true);
    const sourced = texts.find((t) => t.includes('title: E2E sourced seat'))!;
    expect(sourced).toContain(`E2E keep the lane open|${HORMUZ.wireReportId}`);
    expect(texts.some((t) => t.includes('E2E unsourced'))).toBe(false);
    expect((await readdir(cardsDir)).sort()).toHaveLength(filesBefore.length + 2);
  });
});
