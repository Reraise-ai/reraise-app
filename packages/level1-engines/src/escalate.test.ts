// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { buildLevel2Draft } from './escalate.js';
import { createLocalRulesEngine } from './local-rules.js';
import { ID, NAVY_OPTIONS, fixedNow, requestOf, validator } from './test-fixtures.js';

const request = requestOf();
const prediction = await createLocalRulesEngine({ now: fixedNow }).predict(request);

describe('buildLevel2Draft', () => {
  const draft = buildLevel2Draft(prediction, request, ID.navy, { now: fixedNow });

  it('asks for the player next move, with the move options and the cards used placed', () => {
    const { lage, title } = draft.create;
    expect(title).toBe('Next move of Coastal navy (fictional actor profile)');
    expect(lage.question).toContain('most likely next move of Coastal navy');
    expect(lage.question).toContain(request.question);
    expect(lage.options).toEqual(NAVY_OPTIONS);
    const used = prediction.players.find((p) => p.playerCardId === ID.navy)!.cardIds;
    expect(lage.cards.map((c) => c.id).sort()).toEqual([...used].sort());
    expect(lage.cards[0]!.id).toBe(ID.navy);
    expect(lage.seats).toEqual([{ name: 'Analyst', kind: 'human' }]);
    expect(lage.edges).toEqual([]);
    expect(lage.version).toBe(1);
    expect(lage.updatedAt).toBe('2026-10-07T10:00:00.000Z');
  });

  it('links back to the source Lage and engine but copies nothing of the prediction', () => {
    expect(draft.sourceLageId).toBe(ID.lage);
    expect(draft.engine).toBe('local-rules');
    const text = JSON.stringify(draft.create);
    const p = prediction.players.find((x) => x.playerCardId === ID.navy)!;
    expect(text).not.toContain(String(p.confidence));
    expect(text).not.toContain(prediction.requestHash);
    expect(text).not.toContain('estimates');
  });

  it('is a valid body for the human-only lage_create operation', () => {
    const v = validator(
      'https://worldbuilder.invalid/schemas/v0/api.schema.json#/$defs/lageCreateRequest',
    );
    expect(v(draft.create), JSON.stringify(v.errors)).toBe(true);
    const withWorlds = buildLevel2Draft(prediction, request, ID.consortium, {
      worlds: [ID.lage],
      seatName: 'Me',
      grid: 100,
      now: fixedNow,
    });
    expect(v(withWorlds.create), JSON.stringify(v.errors)).toBe(true);
    expect(withWorlds.create.lage.seats[0]!.name).toBe('Me');
    expect(withWorlds.create.worlds).toEqual([ID.lage]);
  });

  it('refuses unknown players, cards outside the request and another Lage', () => {
    expect(() => buildLevel2Draft(prediction, request, ID.stray)).toThrow(/not in the prediction/);
    const fewer = { ...request, cards: request.cards.filter((c) => c.id !== ID.report) };
    expect(() => buildLevel2Draft(prediction, fewer, ID.navy)).toThrow(/not a card of the request/);
    expect(() => buildLevel2Draft(prediction, { ...request, lageId: ID.stray }, ID.navy)).toThrow(
      /another Lage/,
    );
  });
});
