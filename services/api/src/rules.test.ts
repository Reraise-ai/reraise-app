// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// rules_evaluate (ADR-0013): fired or not with triggering cards, no percentage; withheld for
// what a target may not see; only the accepted state counts.

import type { RuleEvaluation } from '@worldbuilder/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectContract, makeFixture, type Fixture } from './test-helpers.js';

let f: Fixture;
beforeAll(async () => {
  f = await makeFixture();
});
afterAll(async () => {
  await f.close();
});

const evaluate = async (who: 'human' | string = 'human'): Promise<RuleEvaluation> => {
  const body = { lageId: f.ids.lage };
  const res =
    who === 'human'
      ? await f.human('POST', '/rules/evaluate', body)
      : await f.agent(who, 'POST', '/rules/evaluate', body);
  expectContract('rules_evaluate', res, 200);
  return res.json();
};
const seedRule = (title: string, rule: unknown, extra: Record<string, unknown> = {}) =>
  f.store.seed(f.store.nextExternalId(), {
    format: 2,
    author: 'human',
    worlds: [f.worldId],
    type: 'rule',
    title,
    visibility: 'public',
    rule,
    ...extra,
  });
const resultOf = (e: RuleEvaluation, ruleId: string) => e.results.find((r) => r.ruleId === ruleId);

describe('on the screen', () => {
  it('fires a card_on_lage rule with its triggering card and no number anywhere', async () => {
    const e = await evaluate();
    expect(e.target).toBe('screen');
    expect(e.withheld).toBe(0);
    expect(resultOf(e, f.ids.rule)).toMatchObject({
      fired: true,
      triggeringCardIds: [f.ids.evPublic],
      unmet: [],
      unknown: [],
    });
    expect(JSON.stringify(e)).not.toMatch(/percent|score|probab|confidence/i);
  });
  it('evaluates a stance condition from the stance of the user', async () => {
    expect(resultOf(await evaluate(), f.ids.stanceRule)).toMatchObject({
      fired: false,
      unmet: [{ clause: 'when', index: 0 }],
    });
    await f.human('PUT', `/cards/${f.ids.evPublic}/stance`, { position: 'believed', weight: 2 });
    expect(resultOf(await evaluate(), f.ids.stanceRule)).toMatchObject({
      fired: true,
      triggeringCardIds: [f.ids.evPublic],
    });
  });
  it('evaluates field, tag and edge conditions, and unless', async () => {
    await f.adapter.patch(f.ids.evPublic, { tags: ['synthetic-tag'] });
    const field = seedRule('field', {
      when: [{ kind: 'card_field', field: 'layer', equals: 'evidenced' }],
      then: 'x',
    });
    const tag = seedRule('tag', { when: [{ kind: 'tag', tag: 'synthetic-tag' }], then: 'x' });
    const edge = seedRule('edge', { when: [{ kind: 'edge', edgeKind: 'supports' }], then: 'x' });
    const blocked = seedRule('unless', {
      when: [{ kind: 'card_on_lage', card: f.ids.evPublic }],
      unless: [{ kind: 'card_field', card: f.ids.evPublic, field: 'type', equals: 'claim' }],
      then: 'x',
    });
    const missing = seedRule('missing', {
      when: [
        { kind: 'card_field', card: '01ARZ3NDEKTSV4RRFFQ69G5FAV', field: 'type', equals: 'claim' },
      ],
      then: 'x',
    });
    const e = await evaluate();
    expect(resultOf(e, field)).toMatchObject({ fired: true, triggeringCardIds: [f.ids.evPublic] });
    expect(resultOf(e, tag)).toMatchObject({ fired: true });
    expect(resultOf(e, edge)).toMatchObject({
      fired: false,
      unmet: [{ clause: 'when', index: 0 }],
    });
    expect(resultOf(e, blocked)).toMatchObject({ fired: false, unmet: [] });
    expect(resultOf(e, missing)).toMatchObject({
      fired: false,
      unknown: [{ clause: 'when', index: 0 }],
    });
  });
});

describe('for a local_model', () => {
  it('omits rules with a stance condition and only counts them', async () => {
    const e = await evaluate('scripted');
    expect(e.target).toBe('local_model');
    expect(resultOf(e, f.ids.stanceRule)).toBeUndefined();
    expect(e.withheld).toBeGreaterThanOrEqual(1);
    expect(resultOf(e, f.ids.rule)).toMatchObject({ fired: true });
    const text = JSON.stringify(e);
    expect(text).not.toContain('"stance"');
  });
  it('omits a rule that depends on a card the gate does not clear', async () => {
    const hidden = seedRule('hidden', {
      when: [{ kind: 'card_on_lage', card: f.ids.evPrivate }],
      then: 'x',
    });
    const e = await evaluate('scripted');
    expect(resultOf(e, hidden)).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain(f.ids.evPrivate);
  });
  it('omits a rule card that is itself private', async () => {
    const priv = seedRule(
      'private rule',
      { when: [{ kind: 'card_on_lage', card: f.ids.evPublic }], then: 'x' },
      { visibility: 'private' },
    );
    const e = await evaluate('scripted');
    expect(resultOf(e, priv)).toBeUndefined();
    expect(resultOf(await evaluate(), priv)).toMatchObject({ fired: true });
  });
});

describe('for a cloud_model', () => {
  it('gets no rule content: the Lage itself is not cleared for it (404)', async () => {
    const res = await f.agent('cloud-scripted', 'POST', '/rules/evaluate', { lageId: f.ids.lage });
    expectContract('rules_evaluate', res, 404);
    expect(res.body).not.toContain('Prefer option');
  });
});
