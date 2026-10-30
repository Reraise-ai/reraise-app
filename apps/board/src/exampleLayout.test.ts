// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The example Lagen place their cards so that no two overlap at the card width of App.css.
// The Hormuz top row stood 200 px apart with 240 px wide cards.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const examples = path.resolve('examples');
const appCss = readFileSync(path.resolve('apps/board/src/App.css'), 'utf8');
const rem = Number(/\.wb-card \{[^}]*width: ([\d.]+)rem;/.exec(appCss)?.[1]);
const CARD_WIDTH = rem * 16;
/** The lowest card in the examples (title, two badge rows, two text lines). */
const CARD_HEIGHT = 140;

const lagen = readdirSync(examples, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    const dir = path.join(examples, d.name, 'cards');
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      return [];
    }
    return files
      .map((f) => [`${d.name}/${f}`, readFileSync(path.join(dir, f), 'utf8')] as const)
      .filter(([, text]) => /^type: lage$/m.test(text));
  });

describe('example Lagen', () => {
  it('reads the card width and finds the Lagen', () => {
    expect(CARD_WIDTH).toBeGreaterThan(0);
    expect(lagen.map(([name]) => name)).toContain('hormuz/10-lage-q4-routing.md');
  });

  it.each(lagen)('%s: no two cards overlap', (_name, text) => {
    const json = /```json\n([\s\S]*?)\n```/.exec(text)?.[1];
    const cards = (JSON.parse(json!) as { cards: { id: string; x: number; y: number }[] }).cards;
    const overlaps = cards.flatMap((a, i) =>
      cards
        .slice(i + 1)
        .filter((b) => Math.abs(a.x - b.x) < CARD_WIDTH && Math.abs(a.y - b.y) < CARD_HEIGHT)
        .map((b) => `${a.id} / ${b.id}`),
    );
    expect(overlaps).toEqual([]);
  });

  it('the Hormuz example proposal places its card clear of the Lage cards', () => {
    const text = lagen.find(([name]) => name === 'hormuz/10-lage-q4-routing.md')![1];
    const json = /```json\n([\s\S]*?)\n```/.exec(text)?.[1];
    const cards = (JSON.parse(json!) as { cards: { x: number; y: number }[] }).cards;
    const proposal = JSON.parse(
      readFileSync(path.join(examples, 'hormuz', 'proposal-create-card.json'), 'utf8'),
    ) as { data: { payload: { x: number; y: number } } };
    const { x, y } = proposal.data.payload;
    expect(
      cards.filter((c) => Math.abs(c.x - x) < CARD_WIDTH && Math.abs(c.y - y) < CARD_HEIGHT),
    ).toEqual([]);
  });
});
