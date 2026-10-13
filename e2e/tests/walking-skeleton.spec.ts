// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// M1 definition of done as one scenario: board UI, Board API, the markdown-files adapter on a
// copy of the synthetic Hormuz store, and the MCP server. A human places a card and draws an
// edge, a scripted agent consults the knowledge and proposes a card, the human accepts, a reload
// shows everything persisted, a context package is built and the disclosure gate withholds the
// private card from a cloud target. The files on disk are checked at the end.

import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scan } from '../support/a11y.js';
import { connectAgent, type ScriptedAgent } from '../support/agent.js';
import { login, openLage } from '../support/board.js';
import { HORMUZ } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();
const AGENT_CARD_TITLE = 'Insurer bulletin corroborates the wire report';
const STANCE_NOTE = 'E2E private stance: I doubt the wire agency';
const INITIAL_VERSION = 3; // examples/hormuz/cards/10-lage-q4-routing.md

interface ConsultResult {
  package: {
    target: string;
    items: { card: { id: string; title: string } }[];
    confirmationRequired?: { transferId: string };
  };
  receipt: { receiptId: string; hash: string; cardIds?: string[] };
}
interface Proposal {
  id: string;
  status: string;
  author: string;
  kind: string;
  decidedBy?: string;
}

/** Reads the position block (the JSON fence) of a Lage file. */
async function readLage(file: string) {
  const text = await readFile(file, 'utf8');
  const block = /```json\n([\s\S]*?)\n```/.exec(text);
  if (!block) throw new Error(`no position block in ${file}`);
  const version = /^version:\s*(\d+)\s*$/m.exec(text);
  return {
    text,
    version: Number(version?.[1]),
    position: JSON.parse(block[1]!) as {
      cards: { id: string }[];
      edges: { from: string; to: string; kind: string; by: string }[];
    },
  };
}

let agent: ScriptedAgent | undefined;
test.afterEach(async () => {
  await agent?.close().catch(() => undefined);
});

test('hormuz walking skeleton', async ({ page }) => {
  const env = getEnv();
  const lageFile = path.join(env.storeDir, 'cards', '10-lage-q4-routing.md');
  const archiveDir = path.join(env.storeDir, 'cards', '_archive');

  await test.step('log in with the session token and open the Hormuz Lage', async () => {
    await login(page, env);
    await expect(page.getByTestId(`lage-item-${HORMUZ.lageId}`)).toContainText('Q4 tanker routing');
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId('board-title')).toHaveText('Q4 tanker routing');
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION));
    await expect(page.getByTestId(`card-node-${HORMUZ.wireReportId}`)).toBeVisible();
    await expect(page.getByTestId(`card-type-${HORMUZ.wireReportId}`)).toHaveText('event');
    await expect(page.getByTestId(`card-node-${HORMUZ.privateCardId}`)).toHaveCount(0);
  });

  await test.step('place an existing card from the search', async () => {
    await page.getByTestId('search-input').fill('rerouting cost');
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId(`search-result-${HORMUZ.privateCardId}`)).toBeVisible();
    await expect(page.getByTestId(`search-type-${HORMUZ.privateCardId}`)).toHaveText('assumption');
    await page.getByTestId(`search-place-${HORMUZ.privateCardId}`).click();
    await expect(page.getByTestId(`card-node-${HORMUZ.privateCardId}`)).toBeVisible();
    await expect(page.getByTestId(`card-type-${HORMUZ.privateCardId}`)).toHaveText('assumption');
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 1));
  });

  await test.step('the card list shows the stored type of an own assessment', async () => {
    await page.getByTestId('search-input').fill('Own assessment');
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId(`search-type-${HORMUZ.ratingHarbourMasterId}`)).toHaveText(
      'rating',
    );
    await expect(page.getByTestId(`search-type-${HORMUZ.ratingNavyId}`)).toHaveText('rating');
  });

  await test.step('draw a supports edge', async () => {
    await page.getByTestId('edge-kind-select').selectOption('supports');
    await page.getByTestId('edge-from').selectOption(HORMUZ.experienceCardId);
    await page.getByTestId('edge-to').selectOption(HORMUZ.privateCardId);
    const rows = page.locator('[data-testid^="edge-row-"]');
    const before = await rows.count();
    await page.getByTestId('edge-add').click();
    await expect(rows).toHaveCount(before + 1);
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 2));
  });

  await test.step('set a private stance through the inspector; it shows on screen only', async () => {
    await page.getByTestId(`card-node-${HORMUZ.navyCardId}`).click();
    await expect(page.getByTestId('inspector-type')).toHaveText('organisation');
    await expect(page.getByTestId('stance-form')).toBeVisible();
    await page.getByTestId('stance-position').selectOption('rejected');
    await page.getByTestId('stance-note').fill(STANCE_NOTE);
    await page.getByTestId('stance-save').click();
    await expect(page.getByTestId(`card-stance-${HORMUZ.navyCardId}`)).toContainText('rejected');
  });

  agent = await connectAgent(env.serviceUrl, env.agents.local.tokenFile);
  const scripted = agent;
  let proposal!: Proposal;
  let cursor: string | undefined;
  await test.step('the scripted agent consults the knowledge and gets a receipt', async () => {
    expect(await scripted.listTools()).toEqual(
      expect.arrayContaining(['knowledge_consult', 'proposal_create', 'proposal_list']),
    );
    const consulted = await scripted.call<ConsultResult>('knowledge_consult', {
      taskRef: 'e2e:task-1',
      task: 'Check whether the insurance spike is corroborated before the Q4 routing decision',
      worldId: HORMUZ.worldId,
      lageId: HORMUZ.lageId,
    });
    expect(consulted.receipt.receiptId).toMatch(/^[0-9A-Z]{26}$/);
    expect(consulted.receipt.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const ids = consulted.package.items.map((i) => i.card.id);
    expect(ids).toContain(HORMUZ.wireReportId);
    // The gate withholds the class A card from a local model, and the receipt says nothing
    // about the task text or any card content.
    expect(ids).not.toContain(HORMUZ.privateCardId);
    expect(JSON.stringify(consulted)).not.toContain(HORMUZ.privateCardBodyText);
    expect(JSON.stringify(consulted.receipt)).not.toContain('insurance spike');
    // The stance is private to the screen: the agent never gets it, nor its note.
    expect(JSON.stringify(consulted)).not.toContain(STANCE_NOTE);
    expect(JSON.stringify(consulted)).not.toContain('"stance"');
  });

  await test.step('the agent reads the board (lage_get) before proposing', async () => {
    const lage = await scripted.call<{ lage: { cards: { id: string }[] } }>('lage_get', {
      lageId: HORMUZ.lageId,
    });
    expect(lage.lage.cards.map((c) => c.id)).toContain(HORMUZ.wireReportId);
    const card = await scripted.call('card_get', { cardId: HORMUZ.navyCardId });
    expect(JSON.stringify([lage, card])).not.toContain(STANCE_NOTE);
    cursor = (await scripted.call<{ nextCursor?: string }>('proposal_list', {})).nextCursor;
  });

  await test.step('the agent proposes a card; nothing counts before the human accepts', async () => {
    proposal = await scripted.call<Proposal>('proposal_create', {
      kind: 'create_card',
      payload: {
        card: {
          format: 2,
          type: 'claim',
          title: AGENT_CARD_TITLE,
          layer: 'said',
          originSystem: 'Synthetic insurer bulletin (e2e)',
          body: 'An invented insurer bulletin repeats that war-risk quotes rose within a day.',
        },
        lageId: HORMUZ.lageId,
        x: 720,
        y: 300,
      },
      rationale: 'Synthetic: a second source for the insurance experience card.',
    });
    expect(proposal.status).toBe('pending');
    expect(proposal.author).toBe(`agent:${env.agents.local.name}`);
    const disk = await readFile(lageFile, 'utf8');
    expect(disk).not.toContain(AGENT_CARD_TITLE);
  });

  await test.step('the proposal shows in the board panel with "What will be applied"', async () => {
    // The panel polls every 2 seconds; no reload and no action of the user.
    const item = page.getByTestId(`proposal-${proposal.id}`);
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId(`proposal-author-${proposal.id}`)).toHaveText(
      `agent:${env.agents.local.name}`,
    );
    await expect(page.getByTestId(`proposal-kind-${proposal.id}`)).toHaveText('create_card');
    const applied = page.getByTestId(`proposal-applied-${proposal.id}`);
    await expect(applied).toContainText('What will be applied');
    await expect(applied).toContainText(AGENT_CARD_TITLE);
    await expect(page.getByTestId('proposals-count')).toHaveText('1 pending');
    await scan(page, 'board with a pending agent proposal');
  });

  await test.step('the human accepts it', async () => {
    await page.getByTestId(`proposal-accept-${proposal.id}`).click();
    await expect(page.getByTestId(`proposal-${proposal.id}`)).toHaveAttribute(
      'data-status',
      'accepted',
    );
    const canvas = page.getByTestId('board-canvas');
    await expect(canvas.getByText(AGENT_CARD_TITLE)).toBeVisible();
    // (the example already has one agent-authored card, by another agent)
    await expect(
      page.locator('[data-testid^="card-author-"]', { hasText: `agent:${env.agents.local.name}` }),
    ).toHaveCount(1);
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 3));
  });

  await test.step('the agent polls proposal_list and sees the human decision', async () => {
    const polled = await scripted.call<{ proposals: Proposal[] }>('proposal_list', {
      ...(cursor === undefined ? {} : { changedSince: cursor }),
    });
    const mine = polled.proposals.find((p) => p.id === proposal.id);
    expect(mine?.status).toBe('accepted');
    expect(mine?.decidedBy).toBe('human');
  });

  await test.step('after a reload the placement, the edge and the accepted card persist', async () => {
    await page.reload();
    await expect(page.getByTestId('lage-list')).toBeVisible(); // the session survives the reload
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId('board-version')).toHaveText(String(INITIAL_VERSION + 3));
    await expect(page.getByTestId(`card-node-${HORMUZ.privateCardId}`)).toBeVisible();
    const edge = page.locator('[data-testid^="edge-row-"]', {
      hasText: 'supports',
    });
    await expect(edge).toHaveCount(1);
    await expect(page.getByTestId('board-canvas').getByText(AGENT_CARD_TITLE)).toBeVisible();
    // (the example already has one agent-authored card, by another agent)
    await expect(
      page.locator('[data-testid^="card-author-"]', { hasText: `agent:${env.agents.local.name}` }),
    ).toHaveCount(1);
    await expect(page.getByTestId(`card-stance-${HORMUZ.navyCardId}`)).toContainText('rejected');
  });

  await test.step('a context package is generated and shown', async () => {
    await page.getByTestId('context-target').selectOption('local_model');
    await page.getByTestId('context-run').click();
    const pkg = page.getByTestId('context-package');
    await expect(pkg).toBeVisible();
    await expect(page.getByTestId(`context-item-${HORMUZ.wireReportId}`)).toBeVisible();
    // The board is a screen caller (the panel says so): the screen sees its own private card.
    await expect(page.getByTestId('context-target-note')).toBeVisible();
    await expect(page.getByTestId(`context-item-${HORMUZ.privateCardId}`)).toBeVisible();
  });

  await test.step('the gate withholds the private card for the cloud and shows no content', async () => {
    await page.getByTestId('context-target').selectOption('cloud_model');
    await expect(page.getByTestId('context-cloud-warning')).toBeVisible();
    await page.getByTestId('context-run').click();
    const preview = page.getByTestId('context-preview');
    await expect(preview).toBeVisible();
    // The denied id is listed, its content and its send entry are not.
    await expect(page.getByTestId(`context-denied-${HORMUZ.privateCardId}`)).toBeVisible();
    await expect(page.getByTestId(`context-send-${HORMUZ.privateCardId}`)).toHaveCount(0);
    await expect(page.getByTestId(`context-send-${HORMUZ.wireReportId}`)).toBeVisible();
    await expect(page.getByTestId('context-panel')).not.toContainText(HORMUZ.privateCardBodyText);
    // Nothing is sent without the confirmation; confirming sends the cleared cards only.
    await expect(page.getByTestId('context-package')).toHaveCount(0);
    await page.getByTestId('context-confirm').click();
    await expect(page.getByTestId('context-package-target')).toHaveText('cloud_model');
    await expect(page.getByTestId(`context-item-${HORMUZ.wireReportId}`)).toBeVisible();
    await expect(page.getByTestId(`context-item-${HORMUZ.privateCardId}`)).toHaveCount(0);
    await expect(page.getByTestId('context-panel')).not.toContainText(HORMUZ.privateCardBodyText);
    // Stances never leave the screen: not in the cloud package view, not its note.
    await expect(
      page.getByTestId('context-panel').locator('[data-testid^="card-stance-"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId('context-panel')).not.toContainText(STANCE_NOTE);
    await expect(page.getByTestId('context-panel')).not.toContainText('rejected');
  });

  await test.step('a cloud agent gets confirmationRequired and no content over MCP', async () => {
    const cloud = await connectAgent(env.serviceUrl, env.agents.cloud.tokenFile);
    try {
      const first = await cloud.call<ConsultResult>('knowledge_consult', {
        taskRef: 'e2e:task-cloud',
        task: 'Cloud agent: summarise the Q4 routing board',
        worldId: HORMUZ.worldId,
        lageId: HORMUZ.lageId,
      });
      expect(first.package.items).toEqual([]);
      expect(first.package.confirmationRequired?.transferId).toBeTruthy();
      expect(JSON.stringify(first)).not.toContain(HORMUZ.privateCardBodyText);
      expect(JSON.stringify(first)).not.toContain(STANCE_NOTE);
    } finally {
      await cloud.close();
    }
  });

  await test.step('the files on disk changed as expected', async () => {
    const lage = await readLage(lageFile);
    expect(lage.version).toBe(INITIAL_VERSION + 3);
    const placed = lage.position.cards.map((c) => c.id);
    expect(placed).toContain(HORMUZ.privateCardId);
    expect(lage.position.edges).toContainEqual({
      from: HORMUZ.experienceCardId,
      to: HORMUZ.privateCardId,
      kind: 'supports',
      by: 'human',
    });
    expect(lage.position.cards).toHaveLength(6 + 2); // the example's six, the placed one, the agent's

    // Each rewrite archived the version it replaced: v3 (the example) up to the one before.
    const archived = (await readdir(archiveDir)).filter((n) =>
      n.startsWith('10-lage-q4-routing.v'),
    );
    expect(archived.sort()).toEqual([3, 4, 5].map((v) => `10-lage-q4-routing.v${v}.md`).sort());
    const v3 = await readLage(path.join(archiveDir, '10-lage-q4-routing.v3.md'));
    expect(v3.version).toBe(INITIAL_VERSION);
    expect(v3.position.cards.map((c) => c.id)).not.toContain(HORMUZ.privateCardId);

    // The agent's card: a new file, authored by the agent, private by default.
    const cardFiles = await readdir(path.join(env.storeDir, 'cards'));
    const texts = await Promise.all(
      cardFiles
        .filter((n) => n.endsWith('.md'))
        .map(async (n) => readFile(path.join(env.storeDir, 'cards', n), 'utf8')),
    );
    const created = texts.filter((t) => t.includes(`title: ${AGENT_CARD_TITLE}`));
    expect(created).toHaveLength(1);
    expect(created[0]).toContain(`author: agent:${env.agents.local.name}`);
    // private by default: no release, no visibility, no training opt-in
    expect(created[0]).not.toMatch(/^(training: true|release:|visibility:)/m);

    // Stances never leave the device: no file anywhere under the store holds the note text.
    const holders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if ((await readFile(full, 'utf8')).includes(STANCE_NOTE)) holders.push(full);
      }
    };
    await walk(env.storeDir);
    expect(holders).toEqual([]);

    // The receipt log of the state directory holds the consults (ids and hashes, no task text).
    const log = await readFile(path.join(env.stateDir, 'receipt-log.jsonl'), 'utf8');
    expect(log.trim().split('\n').length).toBeGreaterThanOrEqual(2);
    expect(log).not.toContain('insurance spike');
  });
});
