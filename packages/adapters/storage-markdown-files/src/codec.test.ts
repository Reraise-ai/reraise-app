// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { CardDraft } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import {
  PATCHABLE_FIELDS,
  applyPatch,
  findSections,
  parseCardText,
  referencedIds,
  renderNewCard,
  type CodecContext,
} from './codec.js';

const STORE = '45aaff12-777f-40e3-a97c-8a592e1ea4f6';
const ID = '01M1E34QM03WVTE8T1RYS3AM18';
const OTHER = '01M1EDEAG082WZ7T7D204BHZDC';
const WORLD = '01M1DZPW00JGXPRPG4179ZPNB8';

const ctx: CodecContext = {
  storeInstanceId: STORE,
  worldId: (name) => (name === 'Hormuz' ? WORLD : `W-${name}`),
  worldName: (id) => {
    if (id === WORLD) return 'Hormuz';
    throw new Error(`unknown world ${id}`);
  },
};

const card = (fm: string, body = ''): string => `---\nid: ${ID}\n${fm}\n---\n${body}`;

describe('parseCardText', () => {
  it('maps a format-2 card, derived identity and edges', () => {
    const { card: c, worldNames } = parseCardText(
      card(
        [
          'format: 2',
          'type: claim',
          'title: T',
          'layer: said',
          'author: human',
          'originSystem: Wiki',
          'worlds: [Hormuz]',
          `edges: [${OTHER}|supports|human]`,
        ].join('\n'),
        '\nBody\n',
      ),
      ctx,
    );
    expect(c.uri).toBe(`wb:${STORE}/${ID}`);
    expect(c.externalId).toBe(ID);
    expect(c.worlds).toEqual([WORLD]);
    expect(worldNames).toEqual(['Hormuz']);
    expect(c.edges).toEqual([{ target: OTHER, kind: 'supports', by: 'human' }]);
    expect(c.body).toBe('Body\n');
    expect(c.training).toBe(false);
    expect(c.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('detects the format and fills the legacy defaults', () => {
    expect(parseCardText(card('type: topic\ntitle: T'), ctx).card).toMatchObject({
      format: 1,
      author: 'unknown',
    });
    expect(parseCardText(card('type: topic\ntitle: T\nlayer: said'), ctx).card.format).toBe(2);
  });

  it('ignores store fields it does not know and takes a CRLF body as LF', () => {
    const text = `---\r\nid: ${ID}\r\ntype: topic\r\ntitle: T\r\nx-foreign: 1\r\n---\r\n\r\nA\r\nB\r\n`;
    const { card: c } = parseCardText(text, ctx);
    expect(c).not.toHaveProperty('x-foreign');
    expect(c.body).toBe('A\nB\n');
  });

  it('rejects files that are not cards', () => {
    expect(() => parseCardText('---\ntype: x\n---\n', ctx)).toThrow(/ULID/);
    expect(() => parseCardText('---\nid: nope\n---\n', ctx)).toThrow(/ULID/);
    for (const key of ['uri', 'externalId', 'contentHash']) {
      expect(() => parseCardText(card(`${key}: x`), ctx)).toThrow(/derived field/);
    }
    expect(() => parseCardText(card(`edges: [${OTHER}|supports]`), ctx)).toThrow(/3 non-empty/);
    expect(() => parseCardText(card('interests: [text only]'), ctx)).toThrow(/2 non-empty/);
  });

  it('reads red lines, assumed goals and one personality type (ADR-0038)', () => {
    const { card: c } = parseCardText(
      card(
        `redLines: [No night convoys|https://example.org/a]\nassumedGoals: [Keep the port open|${OTHER}]\npersonalityType: ISTJ|${OTHER}`,
      ),
      ctx,
    );
    expect(c.redLines).toEqual([{ text: 'No night convoys', source: 'https://example.org/a' }]);
    expect(c.assumedGoals).toEqual([{ text: 'Keep the port open', source: OTHER }]);
    expect(c.personalityType).toEqual({ text: 'ISTJ', source: OTHER });
    expect(() => parseCardText(card(`personalityType: [ISTJ|${OTHER}]`), ctx)).toThrow(
      /one "text\|source" value/,
    );
  });

  it('reads a Lage from front matter and the Position block', () => {
    const state = { question: 'Q?', options: ['a'], cards: [], seats: [], edges: [] };
    const text = card(
      'type: lage\nquestion: Q?\nversion: 2\nupdatedAt: 2026-01-01T00:00:00Z',
      `\n## Position\n\n\`\`\`json\n${JSON.stringify(state)}\n\`\`\`\n`,
    );
    expect(parseCardText(text, ctx).card.lage).toEqual({
      ...state,
      version: 2,
      updatedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('rejects a broken Lage', () => {
    expect(() => parseCardText(card('type: lage', '\nno heading\n'), ctx)).toThrow(/Position/);
    expect(() => parseCardText(card('type: lage', '\n## Position\n\nno block\n'), ctx)).toThrow(
      /json block/,
    );
    expect(() =>
      parseCardText(card('type: lage', '\n## Position\n\n```json\n{nope\n```\n'), ctx),
    ).toThrow(/invalid JSON/);
    expect(() =>
      parseCardText(
        card('type: lage\nquestion: A', '\n## Position\n\n```json\n{"question":"B"}\n```\n'),
        ctx,
      ),
    ).toThrow(/differs/);
  });

  it('reads decision sections, also under the store headings, and maps offen to open', () => {
    const body = [
      '',
      '## Situation',
      'S',
      '## Ausloeser',
      'T',
      '## Verwendete Karten',
      `- ${ID} (note)`,
      '- not an id',
      '## Ergebnis',
      'offen',
      '',
    ].join('\n');
    const sections = parseCardText(card('format: 2\ntype: decision\nauthor: human', body), ctx).card
      .sections;
    expect(sections).toEqual({
      situation: 'S',
      trigger: 'T',
      cardsUsed: [ID, 'not an id'],
      outcome: 'open',
    });
  });

  it('does not take headings inside code fences for sections', () => {
    const body = '\n## Rule\n\n```json\n{"when":[],"then":"x","unless":[]}\n```\n';
    const c = parseCardText(card('type: rule', body), ctx).card;
    expect(c.rule).toEqual({ when: [], then: 'x', unless: [] });
    expect(findSections('```\n## no\n```\n## yes\ntext', 0).map((s) => s.heading)).toEqual(['yes']);
  });
});

const draft = (extra: object = {}): CardDraft =>
  ({
    format: 2,
    collection: 'evidence',
    type: 'claim',
    title: 'Title: with colon',
    layer: 'said',
    source: 'https://example.org/a',
    ...extra,
  }) as CardDraft;

describe('renderNewCard', () => {
  it('writes LF text that reads back as the draft plus identity and author', () => {
    const text = renderNewCard(
      ID,
      draft({ worlds: [WORLD], tags: ['a', 'b'], body: 'Hi' }),
      'human',
      ctx,
    );
    expect(text).not.toContain('\r');
    expect(text.startsWith(`---\nid: ${ID}\nformat: 2\n`)).toBe(true);
    const { card: c } = parseCardText(text, ctx);
    expect(c).toMatchObject({
      id: ID,
      title: 'Title: with colon',
      author: 'human',
      worlds: [WORLD],
      tags: ['a', 'b'],
      body: 'Hi\n',
    });
  });

  it('writes a Lage, a rule and decision sections as structured body sections', () => {
    const lage = {
      question: 'Q?',
      options: ['a'],
      cards: [],
      seats: [],
      edges: [],
      version: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const l = renderNewCard(
      ID,
      { format: 2, type: 'lage', title: 'L', lage, body: 'Intro' } as CardDraft,
      'human',
      ctx,
    );
    expect(l).toContain('question: Q?\nversion: 1\nupdatedAt: 2026-01-01T00:00:00Z\n');
    expect(parseCardText(l, ctx).card.lage).toEqual(lage);
    expect(l).toContain('Intro\n\n## Position');

    const rule = { when: [], then: 'x', unless: [] };
    const r = renderNewCard(
      ID,
      { format: 2, type: 'rule', title: 'R', rule } as CardDraft,
      'human',
      ctx,
    );
    expect(parseCardText(r, ctx).card.rule).toEqual(rule);

    const sections = {
      situation: 's',
      trigger: 't',
      conditions: 'c',
      facts: 'f',
      priorities: 'p',
      action: 'a',
      alternatives: 'alt',
      exclusions: 'e',
      rationale: 'r',
      cardsUsed: [OTHER],
      outcome: 'open',
    };
    const d = renderNewCard(
      ID,
      { format: 2, type: 'decision', title: 'D', sections } as CardDraft,
      'human',
      ctx,
    );
    expect(parseCardText(d, ctx).card.sections).toEqual(sections);
  });

  it('refuses a body or a section value that brings its own structured heading', () => {
    const lage = {
      question: 'Q',
      options: [],
      cards: [],
      seats: [],
      edges: [],
      version: 1,
      updatedAt: '2026-01-01',
    };
    const body = '## Position\n\n```json\n{"question":"Q"}\n```';
    const make = (extra: object) =>
      ({ format: 2, type: 'lage', title: 'L', lage, ...extra }) as CardDraft;
    expect(() => renderNewCard(ID, make({ body }), 'human', ctx)).toThrow(/structured heading/);
    expect(() => renderNewCard(ID, make({ body: '## Rule\n\nx' }), 'human', ctx)).toThrow(
      /structured heading/,
    );
    expect(() => renderNewCard(ID, make({ body: '## Facts\n\nx' }), 'human', ctx)).toThrow(
      /structured heading/,
    );
    // a plain heading is fine
    expect(renderNewCard(ID, make({ body: '## Notes\n\nx' }), 'human', ctx)).toContain('## Notes');
  });

  it('refuses entries that the flow list format cannot hold', () => {
    const bad = draft({
      collection: 'actors',
      interests: [{ text: 'a, b', source: 'https://x.org' }],
    });
    expect(() => renderNewCard(ID, bad, 'human', ctx)).toThrow(/must not be empty or contain/);
    expect(() =>
      renderNewCard(
        ID,
        draft({
          edges: [
            { target: OTHER, kind: 'supports', by: 'human' },
            { target: 'a|b', kind: 'supports', by: 'human' },
          ],
        }),
        'human',
        ctx,
      ),
    ).toThrow(/must not be empty or contain/);
  });
});

describe('applyPatch', () => {
  const base = card(
    'format: 2\ntype: claim\ntitle: Old\nlayer: said\nauthor: human\noriginSystem: Wiki\nx-foreign: keep',
    '\nBody\n',
  );

  it('changes only the patched field', () => {
    expect(applyPatch(base, { title: 'New' }, ctx)).toBe(base.replace('title: Old', 'title: New'));
  });

  it('adds and removes fields, writing worlds by name', () => {
    const out = applyPatch(
      base,
      { status: 'checked', originSystem: undefined, worlds: [WORLD] },
      ctx,
    );
    expect(out).toContain('status: checked');
    expect(out).toContain('worlds: [Hormuz]');
    expect(out).not.toContain('originSystem');
    expect(out).toContain('x-foreign: keep');
  });

  it('replaces the body, keeping the blank line and the file line breaks', () => {
    expect(applyPatch(base, { body: 'New\nbody\n' }, ctx)).toBe(
      base.replace('\nBody\n', '\nNew\nbody\n'),
    );
    const crlf = base.replace(/\n/g, '\r\n');
    expect(applyPatch(crlf, { body: 'A\nB\n' }, ctx)).toBe(crlf.replace('Body\r\n', 'A\r\nB\r\n'));
    expect(applyPatch(base, { body: '' }, ctx).endsWith('---\n')).toBe(true);
    const noBody = card('type: topic\ntitle: T');
    expect(applyPatch(noBody, { body: 'Now' }, ctx)).toBe(`${noBody}\nNow`);
  });

  it('appends a missing rule section and a missing decision section', () => {
    const rule = applyPatch(base, { rule: { when: [], then: 'x', unless: [] } }, ctx);
    expect(rule).toContain('\n## Rule\n\n```json\n{');
    const noEol = applyPatch(
      base.replace(/\n$/, ''),
      { rule: { when: [], then: 'x', unless: [] } },
      ctx,
    );
    expect(noEol).toContain('Body\n\n## Rule');
    const body = '\n## Situation\n\nS\n\n## Outcome\n\nopen\n';
    const dec = card('format: 2\ntype: decision\nauthor: human', body);
    const out = applyPatch(
      dec,
      { sections: { situation: 'S2', trigger: 'T', cardsUsed: [ID] } },
      ctx,
    );
    expect(out).toContain('## Situation\n\nS2\n\n## Outcome');
    expect(out).toContain('## Trigger\n\nT\n');
    expect(out).toContain('## Cards used\n\n- ' + ID + '\n');
    const lastNoEol = applyPatch(dec.replace(/\n$/, ''), { sections: { trigger: 'T' } }, ctx);
    expect(lastNoEol).toContain('open\n\n## Trigger');
  });

  it('fills an existing Position or Rule section that has no json block yet', () => {
    const lage = {
      question: 'Q',
      options: [],
      cards: [],
      seats: [],
      edges: [],
      version: 2,
      updatedAt: '2026-01-02',
    };
    const text = card(
      'type: lage\nquestion: Q\nversion: 1\nupdatedAt: 2026-01-01',
      '\n## Position\n\ntext only\n',
    );
    const out = applyPatch(text, { lage }, ctx);
    expect(out).toContain('## Position\n\n```json\n{');
    expect(out).not.toContain('text only');
  });

  it('has no stance among the patchable fields', () => {
    expect([...PATCHABLE_FIELDS].filter((f) => /stance|position|weight/i.test(f))).toEqual([]);
    for (const f of [
      'id',
      'externalId',
      'uri',
      'format',
      'author',
      'contentHash',
      'level',
      'signature',
    ]) {
      expect(PATCHABLE_FIELDS.has(f)).toBe(false);
    }
  });
});

describe('referencedIds', () => {
  it('collects every store id a card field points to', () => {
    const ids = referencedIds({
      edges: [
        { target: ID, by: 'human' },
        { target: 'legacy', by: 'unknown' },
      ],
      lage: { cards: [{ id: OTHER }], edges: [{ from: OTHER, to: ID }] },
      sections: { cardsUsed: [ID] },
      interests: [{ source: OTHER }, { source: 'https://example.org' }],
    });
    expect(ids.sort()).toEqual([ID, OTHER].sort());
    expect(referencedIds({})).toEqual([]);
  });
});
