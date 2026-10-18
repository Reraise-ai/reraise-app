// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// M2 slice "What-if (non-persisting scenario layer)" on the real stack (board, service, markdown
// files on a copy of the synthetic Hormuz store). A human saves assumptions in the board: no file
// of the store and none of the state directory changes. Recording a decision with "Attach the
// what-if" writes exactly one file, `scenario-attachments/<decisionId>.json`, in the state
// directory. The decision card file is not touched by the attachment: not for the decision made
// here, and not for the decision that was already stored (ADR-0050).

import { expect, test, type APIRequestContext } from '@playwright/test';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { scan } from '../support/a11y.js';
import { login, openLage } from '../support/board.js';
import { HORMUZ, readToken } from '../support/env.js';
import { useStack } from '../support/stack.js';

const getEnv = useStack();
const STORED_DECISION_ID = '01M1F5FBW0DPQND9KSXC12WHJW'; // examples/hormuz, written in an earlier session
const FIRST = 'E2E assumption: the strait stays closed.';
const SECOND = 'E2E assumption: war-risk cover doubles.';
const THIRD = 'E2E assumption: the Cape route adds nine days.';
const FIELDS = [
  'situation',
  'trigger',
  'conditions',
  'facts',
  'priorities',
  'action',
  'alternatives',
  'exclusions',
  'rationale',
] as const;

/** Path, size and modification time of every file under `root`: any write changes this. */
async function treeStamp(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const st = await stat(full);
        out.set(path.relative(root, full).split(path.sep).join('/'), `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  await walk(root);
  return out;
}

/** What a directory gained and what changed in place between two stamps. */
function diff(before: Map<string, string>, after: Map<string, string>) {
  const added = [...after.keys()].filter((k) => !before.has(k)).sort();
  const removed = [...before.keys()].filter((k) => !after.has(k)).sort();
  const changed = [...before.keys()].filter((k) => after.has(k) && after.get(k) !== before.get(k));
  return { added, removed, changed: changed.sort() };
}

/** The only state file that may grow without being a what-if file: the gate's access log. */
const GATE_LOG = 'gate-log.jsonl';

async function allText(root: string): Promise<string> {
  const parts: string[] = [];
  for (const name of (await treeStamp(root)).keys()) {
    parts.push(await readFile(path.join(root, name), 'utf8'));
  }
  return parts.join('\n');
}

async function cardFile(storeDir: string, id: string): Promise<{ name: string; text: string }> {
  const dir = path.join(storeDir, 'cards');
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.md')) continue;
    const text = await readFile(path.join(dir, name), 'utf8');
    if (new RegExp(`^id:\\s*${id}\\s*$`, 'm').test(text)) return { name, text };
  }
  throw new Error(`no card file for ${id}`);
}

async function contentHash(request: APIRequestContext, base: string, token: string, id: string) {
  const res = await request.get(`${base}/cards/${id}`, {
    headers: { 'x-worldbuilder-session': token },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { contentHash: string }).contentHash;
}

test('a what-if layer writes no card, and a recorded decision can attach it as a state file', async ({
  page,
  request,
}) => {
  const env = getEnv();
  const human = { 'x-worldbuilder-session': env.sessionToken };
  const layerUrl = `${env.serviceUrl}/lagen/${HORMUZ.lageId}/scenario`;
  const writes: string[] = [];
  let decisionId = '';

  await test.step('open the Lage: the what-if layer is empty and says it is not cards', async () => {
    await login(page, env);
    await openLage(page, HORMUZ.lageId);
    await expect(page.getByTestId('scenario-empty')).toBeVisible();
    await expect(page.getByTestId('scenario-note')).toContainText('not cards');
    page.on('request', (r) => {
      if (r.url().startsWith(env.serviceUrl) && r.method() !== 'GET')
        writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
  });

  await test.step('saving the layer sends one PUT and changes no file of the store or the state directory', async () => {
    const storeBefore = await treeStamp(env.storeDir);
    const stateBefore = await treeStamp(env.stateDir);

    // A blank line and a repeated line are dropped by the service.
    await page.getByTestId('scenario-lines').fill(`${FIRST}\n\n${SECOND}\n${FIRST}`);
    await page.getByTestId('scenario-save').click();
    await expect(page.getByTestId('scenario-assumption-1')).toHaveText(SECOND);
    await expect(page.getByTestId('scenario-assumption-0')).toHaveText(FIRST);
    await expect(page.getByTestId('scenario-assumption-2')).toHaveCount(0);

    expect(writes).toEqual([`PUT /lagen/${HORMUZ.lageId}/scenario`]);
    expect(diff(storeBefore, await treeStamp(env.storeDir))).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
    // Reading the Lage card to check who may see it is logged by the gate; nothing else moves.
    const state = diff(stateBefore, await treeStamp(env.stateDir));
    expect(state.added).toEqual([]);
    expect(state.removed).toEqual([]);
    expect(state.changed.filter((name) => name !== GATE_LOG)).toEqual([]);
    // No file anywhere holds the text: the layer lives in the service process only.
    expect(await allText(env.storeDir)).not.toContain(FIRST);
    expect(await allText(env.stateDir)).not.toContain(FIRST);

    // The service holds the layer: a plain read gives it back, each assumption with its own id.
    const res = await request.get(layerUrl, { headers: human });
    expect(res.status()).toBe(200);
    const { assumptions } = (await res.json()) as {
      assumptions: { id: string; statement: string }[];
    };
    expect(assumptions.map((a) => a.statement)).toEqual([FIRST, SECOND]);
    expect(new Set(assumptions.map((a) => a.id)).size).toBe(2);
    await scan(page, 'board with a what-if layer');
  });

  await test.step('an agent token cannot read or replace the layer', async () => {
    const agent = { authorization: `Bearer ${readToken(env.agents.local.tokenFile)}` };
    expect((await request.get(layerUrl, { headers: agent })).status()).toBe(403);
    const put = await request.put(layerUrl, {
      headers: agent,
      data: { assumptions: [{ statement: 'Agent assumption.' }] },
    });
    expect(put.status()).toBe(403);
    const layer = (await (await request.get(layerUrl, { headers: human })).json()) as {
      assumptions: { statement: string }[];
    };
    expect(layer.assumptions.map((a) => a.statement)).toEqual([FIRST, SECOND]);
  });

  await test.step('recording a decision with the attach box on writes the decision card and one state file', async () => {
    const storeBefore = await treeStamp(env.storeDir);
    const stateBefore = await treeStamp(env.stateDir);

    await page.getByTestId('decision-title').fill('E2E what-if decision');
    for (const field of FIELDS) {
      await page.getByTestId(`decision-${field}`).fill(`E2E ${field}.`);
    }
    await page.getByTestId(`decision-card-${HORMUZ.wireReportId}`).check();
    await page.getByTestId('decision-attach').check();
    await page.getByTestId('decision-create-submit').click();

    await expect(page.getByTestId('decision-saved')).toHaveText('E2E what-if decision');
    await expect(page.getByTestId('decision-scenario')).toContainText(FIRST);
    await expect(page.getByTestId('decision-scenario')).toContainText(SECOND);
    expect(writes).toContain(`POST /lagen/${HORMUZ.lageId}/scenario/attach`);

    const store = diff(storeBefore, await treeStamp(env.storeDir));
    expect(store.removed).toEqual([]);
    expect(store.changed).toEqual([]);
    // The adapter writes its own `.worldbuilder/.gitignore` on its first write; apart from that
    // only the decision card is new, and no card exists for an assumption.
    const newCards = store.added.filter((name) => name !== '.worldbuilder/.gitignore');
    expect(newCards).toHaveLength(1);
    expect(newCards[0]).toMatch(/^cards\/.+\.md$/);
    const decisionFile = await readFile(path.join(env.storeDir, newCards[0]!), 'utf8');
    expect(decisionFile).toMatch(/^type:\s*decision\s*$/m);
    decisionId = /^id:\s*(\S+)\s*$/m.exec(decisionFile)![1]!;
    expect(decisionFile).not.toContain(FIRST);
    expect(await allText(env.storeDir)).not.toContain(FIRST);

    const state = diff(stateBefore, await treeStamp(env.stateDir));
    expect(state.removed).toEqual([]);
    expect(state.changed.filter((name) => name !== GATE_LOG)).toEqual([]);
    expect(state.added).toEqual([`scenario-attachments/${decisionId}.json`]);
  });

  await test.step('the state file holds both assumptions and the service reads it back', async () => {
    const file = JSON.parse(
      await readFile(path.join(env.stateDir, 'scenario-attachments', `${decisionId}.json`), 'utf8'),
    ) as { decisionId: string; assumptions: { id: string; statement: string }[] };
    expect(file.decisionId).toBe(decisionId);
    expect(file.assumptions.map((a) => a.statement)).toEqual([FIRST, SECOND]);

    const res = await request.get(`${env.serviceUrl}/decisions/${decisionId}/scenario`, {
      headers: human,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(file);
    const none = await request.get(`${env.serviceUrl}/decisions/${HORMUZ.wireReportId}/scenario`, {
      headers: human,
    });
    expect(none.status()).toBe(404);
  });

  await test.step('attaching a changed layer again leaves the decision card file and its hash as they were', async () => {
    for (const id of [decisionId, STORED_DECISION_ID]) {
      const storeBefore = await treeStamp(env.storeDir);
      const fileBefore = await cardFile(env.storeDir, id);
      const hashBefore = await contentHash(request, env.serviceUrl, env.sessionToken, id);

      const put = await request.put(layerUrl, {
        headers: human,
        data: { assumptions: [{ statement: THIRD }, { statement: `For ${id}.` }] },
      });
      expect(put.status()).toBe(200);
      const attach = await request.post(`${layerUrl}/attach`, {
        headers: human,
        data: { decisionId: id },
      });
      expect(attach.status()).toBe(200);

      expect((await cardFile(env.storeDir, id)).text).toBe(fileBefore.text);
      expect(await contentHash(request, env.serviceUrl, env.sessionToken, id)).toBe(hashBefore);
      expect(diff(storeBefore, await treeStamp(env.storeDir))).toEqual({
        added: [],
        removed: [],
        changed: [],
      });
      const file = JSON.parse(
        await readFile(path.join(env.stateDir, 'scenario-attachments', `${id}.json`), 'utf8'),
      ) as { assumptions: { statement: string }[] };
      expect(file.assumptions.map((a) => a.statement)).toEqual([THIRD, `For ${id}.`]);
    }
    // Each decision has its own file; nothing else in the state directory is an attachment.
    expect(
      [...(await treeStamp(env.stateDir)).keys()].filter((k) => k.startsWith('scenario-')),
    ).toEqual(
      [decisionId, STORED_DECISION_ID].map((id) => `scenario-attachments/${id}.json`).sort(),
    );
  });

  await test.step('a card that is not a decision cannot take the layer, and an empty layer attaches nothing', async () => {
    const stateBefore = await treeStamp(env.stateDir);
    const notDecision = await request.post(`${layerUrl}/attach`, {
      headers: human,
      data: { decisionId: HORMUZ.wireReportId },
    });
    expect(notDecision.status()).toBe(404);
    expect(
      (await request.put(layerUrl, { headers: human, data: { assumptions: [] } })).status(),
    ).toBe(200);
    const empty = await request.post(`${layerUrl}/attach`, {
      headers: human,
      data: { decisionId },
    });
    expect(empty.status()).toBe(400);
    const state = diff(stateBefore, await treeStamp(env.stateDir));
    expect(state.added).toEqual([]);
    expect(state.removed).toEqual([]);
    expect(state.changed.filter((name) => name !== GATE_LOG)).toEqual([]);
  });

  await test.step('the gate log names cards and verdicts only: no assumption text reached it', async () => {
    const log = await readFile(path.join(env.stateDir, GATE_LOG), 'utf8');
    expect(log.length).toBeGreaterThan(0);
    for (const text of [FIRST, SECOND, THIRD]) expect(log).not.toContain(text);
  });
});
