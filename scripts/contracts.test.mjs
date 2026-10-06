// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Structural rules of the contracts that ADRs ask to be proven by schema tests, beyond the
// valid and invalid fixtures checked by validate-schemas.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

/** All property names declared anywhere in a schema, with the schema of each. */
function properties(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => properties(n, out));
  else if (node !== null && typeof node === 'object') {
    for (const [name, schema] of Object.entries(node.properties ?? {})) out.push([name, schema]);
    for (const value of Object.values(node)) properties(value, out);
  }
  return out;
}

const VERDICT_NAMES =
  /score|percent|ratio|probab|confidence|aggregate|recommend|verdict|^net$|total/i;

describe('no verdicts (ADR-0013, ADR-0018)', () => {
  it.each(['rule-evaluation.schema.json', 'source-profile.schema.json'])(
    '%s has no score-like field',
    (name) => {
      expect(properties(load(name)).filter(([p]) => VERDICT_NAMES.test(p))).toEqual([]);
    },
  );

  it('rule evaluation has no fractional number at all, only counts and indices', () => {
    const numeric = properties(load('rule-evaluation.schema.json')).filter(
      ([, s]) => s?.type === 'number',
    );
    expect(numeric).toEqual([]);
  });

  it('source profile has exactly the eight dimensions, each with a sample size', () => {
    const s = load('source-profile.schema.json');
    expect(Object.keys(s.properties.dimensions.properties)).toEqual([
      'hitAccuracy',
      'reliability',
      'topicCompetence',
      'agreement',
      'deviation',
      'sourceQuality',
      'historicalPerformance',
      'counterPerspectiveValue',
    ]);
    expect(s.$defs.dimension.required).toContain('n');
    expect(s.$defs.topicDimension.required).toContain('n');
  });
});

describe('card (ADR-0007, ADR-0021, ADR-0023)', () => {
  const content = load('card.schema.json').$defs.content.properties;

  it('reserves level and signature', () => {
    expect(content.level.not).toEqual({});
    expect(content.signature.not).toEqual({});
  });

  it('is private by default and training is opt-in', () => {
    expect(content.release.default).toBe('private');
    expect(content.visibility.default).toBe('private');
    expect(content.training.default).toBe(false);
  });

  it('has no stance-like field', () => {
    expect(Object.keys(content).filter((p) => /stance|believ|position|weight/i.test(p))).toEqual(
      [],
    );
  });

  it('decision sections are exactly the eleven of ADR-0017', () => {
    expect(load('card.schema.json').$defs.decisionSections.required).toEqual([
      'situation',
      'trigger',
      'conditions',
      'facts',
      'priorities',
      'action',
      'alternatives',
      'exclusions',
      'rationale',
      'cardsUsed',
      'outcome',
    ]);
  });
});

describe('shared enums', () => {
  const defs = load('common.schema.json').$defs;

  it('has three layers and no believed layer', () => {
    expect(defs.layer.enum).toEqual(['evidenced', 'said', 'experience']);
  });

  it('has the eight edge kinds of card format v2', () => {
    expect(defs.edgeKind.enum).toHaveLength(8);
  });

  it('has the seven ICD 203 bands in ascending order (ADR-0010)', () => {
    expect(defs.probabilityBand.enum).toEqual([
      'almost_no_chance',
      'very_unlikely',
      'unlikely',
      'roughly_even',
      'likely',
      'very_likely',
      'almost_certain',
    ]);
  });

  it('has no proposal kind that touches stances (ADR-0008)', () => {
    expect(defs.proposalKind.enum.filter((k) => /stance/.test(k))).toEqual([]);
  });
});

describe('stance (ADR-0008)', () => {
  it('has no author or target field: only the local human holds it', () => {
    expect(Object.keys(load('stance.schema.json').properties)).toEqual([
      'cardId',
      'position',
      'weight',
      'note',
      'updatedAt',
      'history',
    ]);
  });
});
