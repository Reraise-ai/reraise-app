// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The local rules engine on the real synthetic Hormuz example cards: the Lage's own cards plus the
// user's rule cards, compared with the committed fixture examples/hormuz/level1-prediction-local-rules.json.

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card, Level1PredictionRequest } from '@worldbuilder/core';
import { MarkdownFilesAdapter } from '@worldbuilder/storage-markdown-files';
import { afterAll, describe, expect, it } from 'vitest';
import { level1PredictionProblems } from '@worldbuilder/conformance';
import { createLocalRulesEngine } from './local-rules.js';
import { formatEstimates } from './format.js';
import { validator } from './test-fixtures.js';

const HORMUZ = fileURLToPath(new URL('../../../examples/hormuz', import.meta.url));
const FIXTURE = path.join(HORMUZ, 'level1-prediction-local-rules.json');
const LAGE = '01M1F21G80R816A1T0V2P6RACH';
const NAVY = '01M1EDEAG082WZ7T7D204BHZDC';
const CONSORTIUM = '01M1EGW640BMD0RDT5NGRMFD70';

const NAVY_OPTIONS = [
  'Keep night transit restrictions',
  'Lift the restrictions',
  'Stop tankers at night',
];
const CONSORTIUM_OPTIONS = [
  'Reroute via the Cape of Good Hope',
  'Hold course and buy war-risk cover',
  'Delay sailings by two weeks',
];

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** The request the board would build for the example Lage: its cards and the user's rule cards. */
async function hormuzRequest(): Promise<Level1PredictionRequest> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wb-l1-'));
  dirs.push(dir);
  await cp(HORMUZ, dir, { recursive: true });
  const store = await MarkdownFilesAdapter.open(dir, { watch: false });
  try {
    const lage = (await store.read(LAGE))!;
    const placed = lage.lage!.cards.map((p) => p.id);
    const all: readonly Card[] = (await store.list()).items;
    const byId = new Map(all.map((c) => [c.id, c] as const));
    const cards = [
      ...placed.map((id) => byId.get(id)!),
      ...all.filter((c) => c.rule !== undefined),
    ];
    return {
      lageId: LAGE,
      question: lage.lage!.question,
      trigger: { kind: 'lage_opened' },
      players: [
        { playerCardId: NAVY, moveOptions: NAVY_OPTIONS },
        { playerCardId: CONSORTIUM, moveOptions: CONSORTIUM_OPTIONS },
      ],
      cards,
    };
  } finally {
    store.close();
  }
}

const engine = createLocalRulesEngine({ now: () => new Date('2026-09-16T10:12:00Z') });

describe('the local rules engine on the Hormuz example', () => {
  it('builds a valid request from the example cards', async () => {
    const request = await hormuzRequest();
    const v = validator(
      'https://worldbuilder.invalid/schemas/v0/level1-prediction.schema.json#/$defs/request',
    );
    expect(v(request), JSON.stringify(v.errors)).toBe(true);
    expect(request.cards.map((c) => c.id)).toContain(NAVY);
    expect(request.cards.filter((c) => c.rule)).toHaveLength(2);
  });

  it('predicts concrete moves for both players', async () => {
    const request = await hormuzRequest();
    const p = await engine.predict(request);
    expect(level1PredictionProblems(engine, request, p)).toEqual([]);
    const [navy, consortium] = p.players;
    expect(navy).toMatchObject({
      playerCardId: NAVY,
      predictedMove: 'Keep night transit restrictions',
    });
    expect(navy!.cardIds[0]).toBe(NAVY);
    // the example rules name neither player, so only the player's own cards decide; with no evidence the first option comes at 1/n
    expect(consortium).toMatchObject({
      playerCardId: CONSORTIUM,
      predictedMove: 'Reroute via the Cape of Good Hope',
      confidence: 0.33,
    });
    expect(formatEstimates(p).map((l) => l.text)).toEqual([
      `local-rules estimates ${navy!.confidence.toFixed(2)} for Keep night transit restrictions`,
      'local-rules estimates 0.33 for Reroute via the Cape of Good Hope',
    ]);
  });

  it('matches the committed fixture (ignoring the time)', async () => {
    const request = await hormuzRequest();
    const timeless = (x: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'predictedAt'));
    const made = timeless({ ...(await engine.predict(request)) });
    const { data } = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
      data: Record<string, unknown>;
    };
    expect(timeless(data)).toEqual(made);
    expect(data.predictedAt).toBe('2026-09-16T10:12:00Z');
  });

  it.skipIf(!process.env.WB_REGENERATE_FIXTURE)('regenerates the fixture', async () => {
    const request = await hormuzRequest();
    const old = JSON.parse(await readFile(FIXTURE, 'utf8')) as Record<string, unknown>;
    old.data = await engine.predict(request);
    await writeFile(FIXTURE, `${JSON.stringify(old, null, 2)}\n`);
  });
});
