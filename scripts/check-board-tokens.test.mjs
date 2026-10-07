// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { checkBoardTokens, scanText } from './check-board-tokens.mjs';
import { makeTree } from './test-helpers.mjs';

const rules = (text) => scanText(text).map((f) => f.rule);

describe('scanText', () => {
  it('flags hex colours of every length', () => {
    for (const hex of ['#fff', '#ffff', '#0d1722', '#0d172280']) {
      expect(rules(`color: ${hex};`)).toEqual(['hex-colour']);
    }
    expect(rules(`const c = '#C9A44C';`)).toEqual(['hex-colour']);
  });

  it('flags colour functions with literals but not var()', () => {
    expect(rules('background: rgb(1, 2, 3);')).toEqual(['colour-function']);
    expect(rules('background: RGBA(1,2,3,.5)')).toEqual(['colour-function']);
    expect(rules('color: hsl(10 20% 30%);')).toEqual(['colour-function']);
    expect(rules('color: oklch(0.5 0.1 200);')).toEqual(['colour-function']);
    expect(rules('color: color(display-p3 1 0 0);')).toEqual(['colour-function']);
    expect(rules('color: var(--wb-text);')).toEqual([]);
  });

  it('flags font-family and the font shorthand with a family', () => {
    expect(rules("font-family: 'Inter', sans-serif;")).toEqual(['font-family']);
    expect(rules("style={{ fontFamily: 'serif' }}")).toEqual(['font-family']);
    expect(rules('font: 12px Georgia;')).toEqual(['font-family']);
  });

  it('allows tokens, inherit, ids, and unrelated words', () => {
    expect(rules('font: inherit;')).toEqual([]);
    expect(rules('font-family: var(--wb-font-body);')).toEqual([]);
    expect(rules("style={{ fontFamily: 'var(--wb-font-body)' }}")).toEqual([]);
    expect(rules('font-size: var(--wb-text-m);')).toEqual([]);
    expect(rules('#root { margin: 0 }')).toEqual([]);
    expect(rules('<a href="#main-content">skip</a>')).toEqual([]);
    expect(rules('color: currentcolor;')).toEqual([]);
    expect(rules('const font = loadFont();')).toEqual([]);
  });

  it('reports the line number', () => {
    expect(scanText('a {}\nb { color: #abc }\n')[0]).toMatchObject({ line: 2 });
  });
});

describe('checkBoardTokens', () => {
  it('passes when only tokens.css holds literals', () => {
    const root = makeTree({
      'apps/board/src/tokens.css': ':root { --wb-a: #0d1722; --wb-font: "Inter"; font-family: x }',
      'apps/board/src/App.css': 'body { color: var(--wb-a); }',
      'apps/board/src/App.tsx': 'export const A = () => null;',
    });
    expect(checkBoardTokens(root)).toEqual([]);
  });

  it('fails on a literal in a component, a stylesheet or the html, naming file and line', () => {
    const root = makeTree({
      'apps/board/src/tokens.css': ':root { --wb-a: #0d1722; }',
      'apps/board/src/App.css': 'a {\n  color: #fff;\n}',
      'apps/board/src/Node.tsx': "export const s = { fontFamily: 'Arial' };",
      'apps/board/index.html': '<body style="background: rgb(0,0,0)">',
      'apps/board/node_modules/x/y.css': 'a { color: #fff }',
    });
    const found = checkBoardTokens(root)
      .map((f) => `${f.file}:${f.line}:${f.rule}`)
      .sort();
    expect(found).toEqual([
      'apps/board/index.html:1:colour-function',
      'apps/board/src/App.css:2:hex-colour',
      'apps/board/src/Node.tsx:1:font-family',
    ]);
  });

  it('ignores files outside the board and tolerates a missing board', () => {
    expect(checkBoardTokens(makeTree({ 'services/api/a.css': 'a { color: #fff }' }))).toEqual([]);
  });
});
