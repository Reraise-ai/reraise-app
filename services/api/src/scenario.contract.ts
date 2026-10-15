// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The what-if contract checks (ADR-0050). They live here so contract.test.ts stays under 1000
// lines. This module is imported by that file, so expectContract marks the operations in the
// same Vitest isolate. covered is per isolate.

import { readdir } from 'node:fs/promises';
import { createLocalStateStore } from '@worldbuilder/local-state';
import { expect } from 'vitest';
import { cardOf, expectContract, type Fixture } from './test-helpers.js';

type Sections = (cardsUsed: string[]) => {
  situation: string;
  trigger: string;
  conditions: string;
  facts: string;
  priorities: string;
  action: string;
  alternatives: string;
  exclusions: string;
  rationale: string;
  cardsUsed: string[];
  outcome: string;
};

/** Replacing the layer writes no card. Attaching it writes one file and leaves the decision. */
export async function proveScenarioContract(f: Fixture, sections: Sections): Promise<void> {
  const stamp = async () =>
    (await f.adapter.list({ limit: 200 })).items.map((c) => `${c.id} ${c.contentHash}`).sort();
  const files = async () => (await readdir(f.stateDir, { recursive: true })).map(String).sort();

  const beforeCards = await stamp();
  const beforeFiles = await files();
  expectContract('scenario_get', await f.human('GET', `/lagen/${f.ids.lage}/scenario`), 200);
  expect((await f.human('GET', `/lagen/${f.ids.lage}/scenario`)).json()).toEqual({
    assumptions: [],
  });

  const replaced = await f.human('PUT', `/lagen/${f.ids.lage}/scenario`, {
    assumptions: [
      { statement: '  The strait stays closed.' },
      { statement: 'The strait stays closed.' },
      { statement: 'War-risk cover doubles.' },
    ],
  });
  expectContract('scenario_replace', replaced, 200);
  const layer = replaced.json() as { assumptions: { id: string; statement: string }[] };
  expect(layer.assumptions.map((a) => a.statement)).toEqual([
    'The strait stays closed.',
    'War-risk cover doubles.',
  ]);
  expect(new Set(layer.assumptions.map((a) => a.id)).size).toBe(2);
  expect(await stamp()).toEqual(beforeCards);
  expect(await files()).toEqual(beforeFiles);

  const extra = await f.human('PUT', `/lagen/${f.ids.lage}/scenario`, {
    assumptions: [{ statement: 'Kept.', extra: true }],
  });
  expectContract('scenario_replace', extra, 400);
  const tooMany = {
    assumptions: Array.from({ length: 21 }, (_, i) => ({
      statement: `Synthetic assumption ${i}.`,
    })),
  };
  expectContract(
    'scenario_replace',
    await f.human('PUT', `/lagen/${f.ids.lage}/scenario`, tooMany),
    400,
  );
  expect((await f.human('GET', `/lagen/${f.ids.lage}/scenario`)).json()).toEqual(layer);

  expectContract(
    'scenario_attach',
    await f.human('POST', `/lagen/${f.ids.lage}/scenario/attach`, { decisionId: f.ids.evPublic }),
    404,
  );
  expectContract('scenario_get', await f.human('GET', `/lagen/${f.ids.evPublic}/scenario`), 404);

  const created = await f.human('POST', '/decisions', {
    format: 2,
    type: 'decision',
    title: 'Synthetic what-if decision',
    sections: sections([f.ids.evPublic]),
  });
  expect(created.statusCode).toBe(201);
  const decision = cardOf(created);
  const afterCreate = await stamp();

  const attached = await f.human('POST', `/lagen/${f.ids.lage}/scenario/attach`, {
    decisionId: decision.id,
  });
  expectContract('scenario_attach', attached, 200);
  expect(attached.json()).toEqual({ decisionId: decision.id, assumptions: layer.assumptions });
  expect(await stamp()).toEqual(afterCreate);
  expect((await f.adapter.read(decision.id!))?.contentHash).toBe(decision.contentHash);

  const readBack = await f.human('GET', `/decisions/${decision.id}/scenario`);
  expectContract('scenario_attachment_get', readBack, 200);
  expect(readBack.json()).toEqual(attached.json());
  const again = await createLocalStateStore({ explicitPath: f.stateDir });
  expect(await again.getScenarioAttachment(decision.id!)).toEqual(attached.json());
  const added = (await files()).filter((name) => !beforeFiles.includes(name));
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((name) => name.includes('scenario-attachments'))).toBe(true);

  expectContract(
    'scenario_attachment_get',
    await f.human('GET', `/decisions/${f.ids.evPublic}/scenario`),
    404,
  );
  const cleared = await f.human('PUT', `/lagen/${f.ids.lage}/scenario`, { assumptions: [] });
  expect(cleared.json()).toEqual({ assumptions: [] });
  expectContract(
    'scenario_attach',
    await f.human('POST', `/lagen/${f.ids.lage}/scenario/attach`, { decisionId: decision.id }),
    400,
  );
}
