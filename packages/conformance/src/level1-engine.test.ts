// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { Card, Level1PredictionRequest } from '@worldbuilder/core';
import { computeContentHash } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import {
  createFixedLevel1Engine,
  describeLevel1EngineConformance,
  level1PredictionProblems,
  releaseCoversRequest,
  releaseOf,
} from './index.js';

const STORE = '45aaff12-777f-40e3-a97c-8a592e1ea4f6';
const card = (id: string, extra: Partial<Card>): Card => {
  const c = {
    id,
    externalId: id,
    uri: `wb:${STORE}/${id}`,
    format: 2,
    type: 'claim',
    title: `Synthetic card ${id}`,
    author: 'human',
    ...extra,
  } as Omit<Card, 'contentHash'>;
  return { ...c, contentHash: computeContentHash(c) } as Card;
};
const navy = card('01M1EDEAG082WZ7T7D204BHZDC', {
  collection: 'actors',
  type: 'organisation',
  layer: 'said',
  originSystem: 'Synthetic analyst wiki',
});
const report = card('01M1E34QM03WVTE8T1RYS3AM18', {
  type: 'event',
  layer: 'evidenced',
  source: 'https://example.org/wire/2026-09-14-transit-restrictions',
});
const request: Level1PredictionRequest = {
  lageId: '01M1F21G80R816A1T0V2P6RACH',
  question: 'Reroute laden tankers around the Cape for Q4?',
  trigger: { kind: 'assumption_changed', cardIds: [report.id] },
  players: [{ playerCardId: navy.id, moveOptions: ['Keep restrictions', 'Lift restrictions'] }],
  cards: [navy, report],
};
const now = () => new Date('2026-10-06T10:00:00Z');

describeLevel1EngineConformance('fixed fake, local', () => ({
  engine: createFixedLevel1Engine({ now }),
  request,
}));
describeLevel1EngineConformance('fixed fake, cloud', () => ({
  engine: createFixedLevel1Engine({ target: 'cloud_model', now }),
  request,
}));

describe('level1PredictionProblems catches non-conformant predictions', () => {
  const engine = createFixedLevel1Engine({ now });
  const good = () => engine.predict(request);

  it('accepts the fake engine', async () => {
    expect(level1PredictionProblems(engine, request, await good())).toEqual([]);
  });

  it.each([
    ['a move outside the options', { predictedMove: 'Close the strait' }, /not a move option/],
    [
      'a card that is not on the board',
      { cardIds: [navy.id, '01M1F8X7G0TTV1CC1FNKTNN0TJ'] },
      /not on the board/,
    ],
    ['no player card among the cards used', { cardIds: [report.id] }, /player card/],
    ['a confidence above 1', { confidence: 1.2 }, /schema/],
    [
      'changed move options',
      { moveOptions: ['Keep restrictions', 'Escalate'] },
      /move options differ/,
    ],
  ])('flags %s', async (_what, patch, message) => {
    const p = await good();
    const bad = { ...p, players: [{ ...p.players[0]!, ...patch }] };
    expect(level1PredictionProblems(engine, request, bad).join('\n')).toMatch(message);
  });

  it('flags a wrong engine id, a wrong request hash and a missing player', async () => {
    const p = await good();
    expect(level1PredictionProblems({ engine: 'other' }, request, p).join()).toMatch(/engine is/);
    const rehashed = { ...p, requestHash: `sha256:${'0'.repeat(64)}` };
    expect(level1PredictionProblems(engine, request, rehashed).join()).toMatch(/requestHash/);
    const twoPlayers = {
      ...request,
      players: [...request.players, { playerCardId: report.id, moveOptions: ['a', 'b'] }],
    };
    expect(level1PredictionProblems(engine, twoPlayers, p).join()).toMatch(/players/);
  });
});

describe('releaseCoversRequest (cloud engines)', () => {
  it('accepts exactly the request cards and refuses anything else', () => {
    expect(releaseCoversRequest(request, releaseOf(request.cards))).toBe(true);
    expect(releaseCoversRequest(request, undefined)).toBe(false);
    expect(releaseCoversRequest(request, releaseOf([navy]))).toBe(false);
    expect(releaseCoversRequest(request, releaseOf([report, navy]))).toBe(false);
    const edited = { ...navy, title: 'Edited' };
    const release = releaseOf([{ ...edited, contentHash: computeContentHash(edited) }, report]);
    expect(releaseCoversRequest(request, release)).toBe(false);
  });
});
