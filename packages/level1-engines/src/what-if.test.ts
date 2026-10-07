// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { createFixedLevel1Engine, releaseOf } from '@worldbuilder/conformance';
import type { Level1Engine } from '@worldbuilder/core';
import { hashJcs } from '@worldbuilder/core';
import { describe, expect, it, vi } from 'vitest';
import { createLocalRulesEngine } from './local-rules.js';
import { ID, card, fixedNow, requestOf } from './test-fixtures.js';
import {
  assumptionChangedRequest,
  changedMoves,
  currentOnly,
  isStale,
  rerunOnAssumptionChange,
} from './what-if.js';

const local = createLocalRulesEngine({ now: fixedNow });
const assumption = card(ID.assumption, {
  type: 'assumption',
  layer: 'said',
  title: 'Keep night transit restrictions will end soon',
});
const base = requestOf();
const changed = assumptionChangedRequest({ ...base, cards: [...base.cards, assumption] }, [
  ID.assumption,
]);

describe('assumptionChangedRequest', () => {
  it('sets the trigger and rejects an empty or duplicated list', () => {
    expect(changed.trigger).toEqual({ kind: 'assumption_changed', cardIds: [ID.assumption] });
    expect(assumptionChangedRequest(base, [ID.assumption, ID.assumption]).trigger).toEqual(
      changed.trigger,
    );
    expect(() => assumptionChangedRequest(base, [])).toThrow(RangeError);
  });
});

describe('staleness', () => {
  it('a prediction is stale unless its hash is the current request hash', async () => {
    const p = await local.predict(base);
    expect(isStale(p, base)).toBe(false);
    expect(isStale(p, changed)).toBe(true);
    expect(isStale(undefined, base)).toBe(true);
    expect(currentOnly(p, base)).toBe(p);
    expect(currentOnly(p, changed)).toBeUndefined();
  });
});

describe('rerunOnAssumptionChange', () => {
  it('re-runs a local engine when the request hash changed and reports move changes', async () => {
    const previous = await local.predict(base);
    const r = await rerunOnAssumptionChange(local, previous, changed);
    expect(r).toMatchObject({ reran: true, stale: false, needsConfirmation: false });
    expect(r.prediction!.requestHash).toBe(hashJcs(changed));
    expect(r.prediction!.trigger).toEqual(changed.trigger);
    expect(r.changes).toEqual([]); // the assumption does not alter the navy or the consortium
  });

  it('reports a player whose predicted move changed', async () => {
    const lastOption: Level1Engine = {
      ...local,
      predict: async (request) => {
        const p = await local.predict(request);
        return {
          ...p,
          players: p.players.map((x) => ({
            ...x,
            predictedMove: x.moveOptions.at(-1)!,
            confidence: 0.5,
          })),
        };
      },
    };
    const previous = await local.predict(base);
    const r = await rerunOnAssumptionChange(lastOption, previous, changed);
    expect(r.changes.map((c) => c.playerCardId)).toEqual([ID.navy, ID.consortium]);
    expect(r.changes[0]).toMatchObject({
      from: 'Keep night transit restrictions',
      to: 'Stop tankers at night',
      confidenceTo: 0.5,
    });
  });

  it('does not run when the previous prediction already matches', async () => {
    const spy = vi.spyOn(local, 'predict');
    const previous = await local.predict(changed);
    spy.mockClear();
    const r = await rerunOnAssumptionChange(local, previous, changed);
    expect(spy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reran: false, stale: false, prediction: previous });
    spy.mockRestore();
  });

  it('runs without a previous prediction', async () => {
    const r = await rerunOnAssumptionChange(local, undefined, changed);
    expect(r.reran).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it('never re-runs a cloud engine by itself: stale, needs a new confirmation', async () => {
    const cloud = createFixedLevel1Engine({ target: 'cloud_model', now: fixedNow });
    const spy = vi.spyOn(cloud, 'predict');
    const previous = await cloud.predict(base, releaseOf(base.cards));
    spy.mockClear();
    const r = await rerunOnAssumptionChange(cloud, previous, changed);
    expect(spy).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      reran: false,
      stale: true,
      needsConfirmation: true,
      prediction: previous,
    });
    const none = await rerunOnAssumptionChange(cloud, undefined, changed);
    expect(none).toMatchObject({ stale: false, prediction: undefined, needsConfirmation: true });
  });

  it('re-runs a cloud engine once the caller holds the release of a new confirmed transfer', async () => {
    const cloud = createFixedLevel1Engine({ target: 'cloud_model', now: fixedNow });
    const previous = await cloud.predict(base, releaseOf(base.cards));
    const r = await rerunOnAssumptionChange(cloud, previous, changed, releaseOf(changed.cards));
    expect(r).toMatchObject({ reran: true, stale: false, needsConfirmation: false });
  });

  it('refuses a request that is not an assumption change', async () => {
    await expect(rerunOnAssumptionChange(local, undefined, base)).rejects.toThrow(RangeError);
  });
});

describe('changedMoves', () => {
  it('is empty without a previous prediction and ignores players that were not predicted before', async () => {
    const p = await local.predict(base);
    expect(changedMoves(undefined, p)).toEqual([]);
    expect(changedMoves({ ...p, players: [] }, p)).toEqual([]);
  });
});
