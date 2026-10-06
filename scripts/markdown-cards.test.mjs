// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import {
  buildUri,
  canonicalJson,
  computeContentHash,
  encodeExternalId,
  parseDecisionSections,
  parseEdges,
  parseJsonSection,
  parsePlayerField,
  splitFrontMatter,
  toCanonicalCard,
} from './markdown-cards.mjs';

const STORE = '45aaff12-777f-40e3-a97c-8a592e1ea4f6';
const ID = '01M1E34QM03WVTE8T1RYS3AM18';
const WORLD = '01M1DZPW00JGXPRPG4179ZPNB8';
const store = { storeInstanceId: STORE, worlds: new Map([['Hormuz', WORLD]]) };

describe('uri', () => {
  it('keeps unreserved characters and percent-encodes everything else in upper-case hex', () => {
    expect(encodeExternalId('x-14')).toBe('x-14');
    expect(encodeExternalId('a b/c!*')).toBe('a%20b%2Fc%21%2A');
    expect(buildUri(STORE, 'x-14')).toBe(`wb:${STORE}/x-14`);
  });

  it('NFC-normalises before encoding and preserves case', () => {
    expect(encodeExternalId('Müller')).toBe(encodeExternalId('Müller'));
    expect(encodeExternalId('Müller')).toBe('M%C3%BCller');
  });
});

describe('content hash (ADR-0034)', () => {
  it('matches the vector pinned in packages/core', () => {
    const card = {
      format: 2,
      type: 'claim',
      title: 'A claim',
      layer: 'said',
      author: 'human',
      source: 'https://example.org/a',
    };
    expect(computeContentHash({ ...card, id: ID, rating: 3 })).toBe(
      'sha256:399ebae5060e1018f43fe6c9faa97ceea3cbc28b0abc740df50cc4c659b5cd27',
    );
    expect(canonicalJson({ b: 1, '\u20ac': [1e21, undefined], a: { d: 0.1 } })).toBe(
      '{"a":{"d":0.1},"b":1,"€":[1e+21,null]}',
    );
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});

describe('front matter', () => {
  it('splits front matter and body', () => {
    expect(splitFrontMatter('---\na: 1\n---\n\nBody\n')).toEqual({
      data: { a: 1 },
      body: 'Body\n',
    });
  });

  it('rejects files without a mapping', () => {
    expect(() => splitFrontMatter('no front matter')).toThrow('missing YAML front matter');
    expect(() => splitFrontMatter('---\n- a\n---\n')).toThrow('not a mapping');
  });
});

describe('pipe lists', () => {
  it('parses edges and player-field entries', () => {
    expect(parseEdges([`${ID}|cites|agent:helper`])).toEqual([
      { target: ID, kind: 'cites', by: 'agent:helper' },
    ]);
    expect(parsePlayerField([`Hold the lane|https://example.org/a`])).toEqual([
      { text: 'Hold the lane', source: 'https://example.org/a' },
    ]);
  });

  it('rejects entries with a missing part', () => {
    expect(() => parseEdges([`${ID}|cites`])).toThrow('3 non-empty parts');
    expect(() => parsePlayerField(['Hold the lane|'])).toThrow('2 non-empty parts');
  });
});

describe('structured bodies', () => {
  it('parses decision sections and card ids', () => {
    const body = `## Situation\n\nS\n\n## Cards used\n\n- ${ID} (wire report)\n- other\n\n## Outcome\n\nopen\n`;
    expect(parseDecisionSections(body)).toEqual({
      situation: 'S',
      cardsUsed: [ID, 'other'],
      outcome: 'open',
    });
  });

  it('parses a JSON section and reports a missing one', () => {
    expect(parseJsonSection('## Position\n\n```json\n{"a": 1}\n```\n', 'Position')).toEqual({
      a: 1,
    });
    expect(() => parseJsonSection('## Notes\n', 'Position')).toThrow('no "## Position"');
    expect(() => parseJsonSection('## Position\n\nnone\n', 'Position')).toThrow('no ```json');
  });
});

describe('toCanonicalCard', () => {
  it('derives externalId, uri, body and the legacy defaults of a format-1 card', () => {
    const card = toCanonicalCard(
      `---\nid: ${ID}\ntype: topic\ntitle: T\nsynthetic: true\n---\nText\n`,
      store,
    );
    expect(card).toEqual({
      id: ID,
      type: 'topic',
      title: 'T',
      format: 1,
      author: 'unknown',
      training: false,
      externalId: ID,
      uri: `wb:${STORE}/${ID}`,
      body: 'Text\n',
      contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it('detects format 2 from a format-2 field and resolves world names', () => {
    const card = toCanonicalCard(
      `---\nid: ${ID}\ntitle: T\nauthor: human\nworlds: [Hormuz]\n---\n`,
      store,
    );
    expect(card.format).toBe(2);
    expect(card.worlds).toEqual([WORLD]);
    expect(() => toCanonicalCard(`---\nid: ${ID}\nworlds: [Nowhere]\n---\n`, store)).toThrow(
      'unknown world "Nowhere"',
    );
  });

  it('refuses derived fields in front matter', () => {
    expect(() => toCanonicalCard(`---\nid: ${ID}\nuri: wb:x/y\n---\n`, store)).toThrow(
      'derived field "uri"',
    );
  });

  it('builds the Lage state from front matter and the Position block', () => {
    const text = `---\nid: ${ID}\nformat: 2\ntype: lage\nquestion: Q?\nversion: 2\nupdatedAt: 2026-09-16\n---\n## Position\n\n\`\`\`json\n{"options": [], "cards": [], "seats": [], "edges": []}\n\`\`\`\n`;
    const card = toCanonicalCard(text, store);
    expect(card.lage).toEqual({
      question: 'Q?',
      options: [],
      cards: [],
      seats: [],
      edges: [],
      version: 2,
      updatedAt: '2026-09-16',
    });
    expect(card).not.toHaveProperty('question');
    expect(() =>
      toCanonicalCard(text.replace('```json\n{', '```json\n{"question": "Other?", '), store),
    ).toThrow('question differs');
  });

  it('parses sections only for format-2 decisions and rules from their block', () => {
    const legacy = toCanonicalCard(`---\nid: ${ID}\ntype: decision\n---\n## Situation\nS\n`, store);
    expect(legacy.sections).toBeUndefined();
    const rule = toCanonicalCard(
      `---\nid: ${ID}\ntype: rule\nauthor: human\n---\n## Rule\n\n\`\`\`json\n{"then": "x"}\n\`\`\`\n`,
      store,
    );
    expect(rule.rule).toEqual({ then: 'x' });
  });
});
