// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { Card, Rule } from '@worldbuilder/core';
import {
  describeLevel1EngineConformance,
  level1PredictionProblems,
} from '@worldbuilder/conformance';
import { hashJcs } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_TEMPERATURE,
  EXCLUSION_CONFIDENCE_CAP,
  MAX_CONFIDENCE,
  NO_NEW_ACTION,
  buildMoveOptions,
  createLocalRulesEngine,
  explainLocalRules,
} from './local-rules.js';
import {
  CONSORTIUM_OPTIONS,
  ID,
  NAVY_OPTIONS,
  card,
  consortium,
  fixedNow,
  navy,
  report,
  requestOf,
  rule,
} from './test-fixtures.js';

const engine = createLocalRulesEngine({ now: fixedNow });

describeLevel1EngineConformance('local rules engine', () => ({
  engine,
  request: requestOf({ trigger: { kind: 'assumption_changed', cardIds: [ID.assessment] } }),
}));

const player = (p: Awaited<ReturnType<typeof engine.predict>>, id: string) =>
  p.players.find((x) => x.playerCardId === id)!;

describe('local rules engine: predictions', () => {
  it('predicts what the player did before, with the cards behind it (navy)', async () => {
    const request = requestOf();
    const p = await engine.predict(request);
    expect(level1PredictionProblems(engine, request, p)).toEqual([]);
    const navyP = player(p, ID.navy);
    expect(navyP.predictedMove).toBe('Keep night transit restrictions');
    expect(navyP.confidence).toBeGreaterThan(1 / 3);
    expect(navyP.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
    expect(navyP.cardIds[0]).toBe(ID.navy);
    expect(navyP.cardIds).toContain(ID.report);
    // the rule card concerns another option, so it was not used for the navy
    expect(navyP.cardIds).not.toContain(ID.rule);
  });

  it('removes an option that crosses a red line but keeps one that meets its condition', async () => {
    const request = requestOf({
      players: [
        {
          playerCardId: ID.consortium,
          moveOptions: ['Sail without war-risk cover', 'Hold course and buy war-risk cover'],
        },
      ],
    });
    const ex = explainLocalRules(request).players[0]!;
    expect(ex.options[0]!.excluded).toBe(true);
    expect(ex.options[0]!.redLineHits[0]).toMatchObject({ kind: 'hard' });
    expect(ex.options[0]!.probability).toBe(0);
    expect(ex.options[1]!.excluded).toBe(false);
    expect(ex.predictedMove).toBe('Hold course and buy war-risk cover');
    expect(ex.confidence).toBeLessThanOrEqual(EXCLUSION_CONFIDENCE_CAP);
  });

  it('removes an option that lets foreign warships into territorial waters (navy red line)', () => {
    const request = requestOf({
      players: [
        {
          playerCardId: ID.navy,
          moveOptions: [
            'Allow foreign warships into territorial waters',
            'Keep night transit restrictions',
          ],
        },
      ],
    });
    const ex = explainLocalRules(request).players[0]!;
    expect(ex.options[0]!.excluded).toBe(true);
    expect(ex.predictedMove).toBe('Keep night transit restrictions');
  });

  it('penalises a weak red-line match instead of removing the option', () => {
    const ex = explainLocalRules(requestOf()).players[1]!;
    const delay = ex.options.find((o) => o.move.startsWith('Delay'))!;
    expect(delay.excluded).toBe(false);
    expect(delay.redLineHits[0]).toMatchObject({ kind: 'soft', sharedWords: 1 });
    expect(delay.contributions.redLineRisk).toBeLessThan(0);
  });

  it('penalises a disruptive option that touches a dependency', () => {
    const request = requestOf({
      players: [
        {
          playerCardId: ID.navy,
          moveOptions: [
            'Halt oil export revenue through the strait',
            'Keep night transit restrictions',
          ],
        },
      ],
    });
    const ex = explainLocalRules(request).players[0]!;
    expect(ex.options[0]!.features.dependencyRisk.value).toBeGreaterThan(0);
    expect(ex.options[0]!.contributions.dependencyRisk).toBeLessThan(0);
    expect(ex.options[1]!.features.dependencyRisk.value).toBe(0);
  });

  it('reads a fired user rule whose action matches an option as the user expectation', () => {
    const ex = explainLocalRules(requestOf()).players[1]!;
    expect(ex.firedRuleCardIds).toEqual([ID.rule]);
    const reroute = ex.options[0]!;
    expect(reroute.features.rule.value).toBe(1);
    expect(reroute.features.rule.via).toEqual(expect.arrayContaining([ID.rule, ID.report]));
  });

  it('does not fire a rule when an unless condition holds, a condition fails, or it needs a stance', () => {
    const refuting = card(ID.stray, {
      type: 'claim',
      layer: 'said',
      edges: [{ target: ID.report, kind: 'refutes', by: 'human' }],
    });
    const cards = [navy, consortium, report, refuting, rule];
    expect(explainLocalRules(requestOf({ cards })).players[1]!.firedRuleCardIds).toEqual([]);
    const without = [navy, consortium, rule];
    expect(explainLocalRules(requestOf({ cards: without })).players[1]!.firedRuleCardIds).toEqual(
      [],
    );
    const stanceRule: Card = card('01M1EV5S00YXKKGEG772AZM7PA', {
      type: 'rule',
      rule: {
        when: [{ kind: 'stance', card: ID.report, position: 'believed' }],
        then: 'Reroute via the Cape of Good Hope',
      },
    });
    const r = requestOf({ cards: [navy, consortium, report, stanceRule] });
    expect(explainLocalRules(r).players[1]!.firedRuleCardIds).toEqual([]);
  });

  it('evaluates tag, field and edge conditions on the request cards', () => {
    const tagged = card(ID.stray, {
      type: 'claim',
      tags: ['hormuz'],
      edges: [{ target: ID.navy, kind: 'supports', by: 'human' }],
    });
    const mk = (when: Rule['when']) =>
      card('01M1EV5S00YXKKGEG772AZM7PB', {
        type: 'rule',
        rule: { when, then: 'Reroute via the Cape of Good Hope' },
      });
    const fires = (c: Card) =>
      explainLocalRules(requestOf({ cards: [navy, consortium, tagged, c] })).players[1]!
        .firedRuleCardIds.length;
    expect(fires(mk([{ kind: 'tag', tag: 'hormuz' }]))).toBe(1);
    expect(fires(mk([{ kind: 'tag', card: ID.stray, tag: 'other' }]))).toBe(0);
    expect(fires(mk([{ kind: 'card_field', field: 'type', equals: 'claim' }]))).toBe(1);
    expect(fires(mk([{ kind: 'edge', edgeKind: 'supports', from: ID.stray, to: ID.navy }]))).toBe(
      1,
    );
    expect(fires(mk([{ kind: 'edge', edgeKind: 'supports', from: ID.navy }]))).toBe(0);
  });

  it('weights behaviour over statements and reports the divergence', () => {
    const p = card(ID.navy, {
      collection: 'actors',
      type: 'organisation',
      interests: [{ text: 'Open the lane to all traffic', source: 'https://example.org/a' }],
      moves: [{ text: 'Closed the lane to traffic', source: 'https://example.org/b' }],
    });
    const request = requestOf({
      players: [
        {
          playerCardId: ID.navy,
          moveOptions: ['Open the lane to all traffic', 'Close the lane to traffic'],
        },
      ],
      cards: [p],
    });
    const ex = explainLocalRules(request).players[0]!;
    expect(ex.statementBehaviourDivergence).toBe(true);
    expect(ex.predictedMove).toBe('Close the lane to traffic');
  });

  it('counts linked evidence cards as behaviour when evidenced and as statement when said', () => {
    const p = card(ID.navy, {
      collection: 'actors',
      type: 'organisation',
      edges: [
        { target: ID.report, kind: 'represents', by: 'human' },
        { target: ID.assessment, kind: 'relation', by: 'human' },
      ],
    });
    const said = card(ID.assessment, {
      type: 'rating',
      layer: 'said',
      title: 'Expects a fee deal soon',
    });
    const request = requestOf({
      players: [
        {
          playerCardId: ID.navy,
          moveOptions: ['Announce transit restrictions', 'Expect a fee deal'],
        },
      ],
      cards: [p, report, said],
    });
    const ex = explainLocalRules(request).players[0]!;
    expect(ex.options[0]!.features.linkedEvidenced.value).toBeGreaterThan(0);
    expect(ex.options[1]!.features.linkedSaid.value).toBeGreaterThan(0);
    expect(ex.predictedMove).toBe('Announce transit restrictions');
    expect(ex.cardIds).toEqual(expect.arrayContaining([ID.report, ID.assessment]));
  });

  it('follows depends_on edges to board cards as dependencies', () => {
    const dep = card(ID.stray, { type: 'organisation', title: 'Harbour pilots association' });
    const p = card(ID.navy, {
      collection: 'actors',
      type: 'organisation',
      edges: [{ target: ID.stray, kind: 'depends_on', by: 'human' }],
    });
    const request = requestOf({
      players: [
        { playerCardId: ID.navy, moveOptions: ['Suspend harbour pilots association', 'Wait'] },
      ],
      cards: [p, dep],
    });
    const ex = explainLocalRules(request).players[0]!;
    expect(ex.options[0]!.features.dependencyRisk.via).toEqual([ID.stray]);
  });

  it('says it knows nothing: no evidence gives uniform confidence and the first option', async () => {
    const bare = card(ID.navy, { collection: 'actors', type: 'organisation' });
    const request = requestOf({
      players: [{ playerCardId: ID.navy, moveOptions: ['Alpha', 'Beta', 'Gamma', 'Delta'] }],
      cards: [bare],
    });
    const p = await engine.predict(request);
    expect(p.players[0]).toMatchObject({
      predictedMove: 'Alpha',
      confidence: 0.25,
      cardIds: [ID.navy],
    });
    expect(explainLocalRules(request).players[0]!.evidenceKinds).toBe(0);
  });

  it('shrinks the confidence when only one kind of evidence exists', () => {
    const one = card(ID.navy, {
      collection: 'actors',
      type: 'organisation',
      moves: [{ text: 'Announced night transit restrictions', source: 'https://example.org/a' }],
    });
    const two = card(ID.navy, {
      ...one,
      interests: [
        { text: 'Keep night transit restrictions in force', source: 'https://example.org/a' },
      ],
    });
    const opts = ['Keep night transit restrictions', 'Lift the restrictions'];
    const players = [{ playerCardId: ID.navy, moveOptions: opts }];
    const c1 = explainLocalRules(requestOf({ players, cards: [one] })).players[0]!.confidence;
    const c2 = explainLocalRules(requestOf({ players, cards: [two] })).players[0]!.confidence;
    expect(c1).toBeGreaterThan(0.5);
    expect(c2).toBeGreaterThan(c1);
  });

  it('predicts the least bad option at uniform confidence when every option crosses a red line', () => {
    const request = requestOf({
      players: [
        {
          playerCardId: ID.navy,
          moveOptions: [
            'Allow foreign warships into territorial waters',
            'Let foreign warships inside territorial waters',
          ],
        },
      ],
    });
    const ex = explainLocalRules(request).players[0]!;
    expect(ex.allExcluded).toBe(true);
    expect(ex.confidence).toBe(0.5);
    expect(ex.options.every((o) => o.excluded)).toBe(true);
  });

  it('documents its temperature and reports a breakdown whose probabilities sum to 1', () => {
    const ex = explainLocalRules(requestOf()).players[0]!;
    expect(ex.temperature).toBe(CONFIDENCE_TEMPERATURE);
    const sum = ex.options.reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeGreaterThan(0.98);
    expect(sum).toBeLessThan(1.02);
  });

  it('names only cards of the request, with a source that is not on the board left out', async () => {
    const request = requestOf({ cards: [navy, consortium] });
    const p = await engine.predict(request);
    const ids = new Set(request.cards.map((c) => c.id));
    for (const pl of p.players) for (const id of pl.cardIds) expect(ids.has(id)).toBe(true);
  });

  it('is deterministic and does not change the request', async () => {
    const request = requestOf();
    const before = hashJcs(request);
    const a = await engine.predict(request);
    const b = await engine.predict(structuredClone(request));
    expect(b).toEqual(a);
    expect(hashJcs(request)).toBe(before);
    expect(a.requestHash).toBe(before);
    expect(a.predictedAt).toBe('2026-10-07T10:00:00.000Z');
  });

  it('rejects a request whose player card is missing', async () => {
    await expect(engine.predict(requestOf({ cards: [report] }))).rejects.toThrow(
      /not a card of the request/,
    );
  });

  it('exposes explain() and a custom engine id', () => {
    const e = createLocalRulesEngine({ engine: 'local-rules-test' });
    expect(e.explain(requestOf()).engine).toBe('local-rules-test');
    expect(e.target).toBe('local_model');
    expect(e.deterministic).toBe(true);
  });

  it('works for the Hormuz example players with the expected moves', async () => {
    const p = await engine.predict(requestOf());
    expect(player(p, ID.navy).predictedMove).toBe(NAVY_OPTIONS[0]);
    // the user's rule and the consortium's red line meet in one option each
    expect(CONSORTIUM_OPTIONS).toContain(player(p, ID.consortium).predictedMove);
  });
});

describe('buildMoveOptions', () => {
  it('uses past moves, then rule actions not already covered, then extras, without duplicates', () => {
    const p = card(ID.navy, {
      collection: 'actors',
      type: 'organisation',
      moves: [
        { text: 'Announced night transit restrictions', source: ID.report },
        { text: 'announced night transit restrictions', source: ID.report },
      ],
    });
    const out = buildMoveOptions(p, [rule], ['Lift the restrictions', '  ']);
    expect(out).toEqual([
      'Announced night transit restrictions',
      'Reroute laden tankers via the Cape of Good Hope',
      'Lift the restrictions',
    ]);
  });

  it('adds a no-action option when fewer than two exist and caps the list', () => {
    const p = card(ID.navy, { collection: 'actors', type: 'organisation' });
    expect(buildMoveOptions(p, [])).toEqual([NO_NEW_ACTION]);
    const many = Array.from(
      { length: 20 },
      (_, i) => `Distinct option number${'x'.repeat(i)} thing${i}`,
    );
    expect(buildMoveOptions(p, [], many)).toHaveLength(8);
  });
});
