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

  it('flags named colours in colour properties, not neutral keywords or tokens', () => {
    expect(rules('color: red;')).toEqual(['named-colour']);
    expect(rules('background: linear-gradient(to right, navy, white);')).toEqual(['named-colour']);
    expect(rules('border: 1px solid Gray;')).toEqual(['named-colour']);
    expect(rules("style={{ backgroundColor: 'tomato' }}")).toEqual(['named-colour']);
    expect(rules('box-shadow: 0 0 4px black;')).toEqual(['named-colour']);
    for (const ok of [
      'color: transparent;',
      'color: currentColor;',
      'color: inherit;',
      'background: none;',
      'border: 1px solid var(--wb-line);',
      'color: var(--wb-color-red);',
      'fill: var(--wb-accent);',
      'background-image: url(red.png);',
      'content: "red";',
    ]) {
      expect(rules(ok)).toEqual([]);
    }
  });

  it('flags colour literals in JSX and SVG attributes', () => {
    expect(rules('<path fill="red" />')).toEqual(['colour-attribute']);
    expect(rules("<circle stroke={'navy'} />")).toEqual(['colour-attribute']);
    expect(rules('<stop stopColor="orange" />')).toEqual(['colour-attribute']);
    expect(rules('<feFlood floodColor="rgb(0 0 0)" />')).toContain('colour-attribute');
    expect(rules('<path fill="none" stroke="currentColor" />')).toEqual([]);
    expect(rules('<path fill="var(--wb-accent)" />')).toEqual([]);
    expect(rules('<path fill="url(#grad)" />')).toEqual([]);
  });

  it('flags a font-family attribute', () => {
    expect(rules('<text fontFamily="Arial">x</text>')).toEqual(['font-family']);
    expect(rules('<text font-family="serif">x</text>')).toEqual(['font-family']);
    expect(rules('<text fontFamily="var(--wb-font-body)">x</text>')).toEqual([]);
  });

  it('flags color-mix with a literal colour, not with tokens only', () => {
    expect(rules('background: color-mix(in srgb, red 40%, var(--wb-surface));')).toContain(
      'color-mix',
    );
    expect(rules('background: color-mix(in srgb, #fff, #000);')).toContain('color-mix');
    expect(
      rules('background: color-mix(in srgb, var(--wb-accent) 40%, var(--wb-surface));'),
    ).toEqual([]);
    expect(rules('background: color-mix(in oklab, var(--wb-a), transparent 50%);')).toEqual([]);
  });

  it('flags a colour in a data URI and a colour built from a # string', () => {
    expect(rules('background: url("data:image/svg+xml,%3Csvg fill=\'%23c9a44c\'/%3E");')).toContain(
      'data-uri-colour',
    );
    expect(rules("const c = '#' + hex;")).toEqual(['concatenated-hex']);
    expect(rules('const c = `#${hex}`;')).toEqual(['concatenated-hex']);
  });

  it('does not take an SVG reference or an anchor for a colour', () => {
    expect(rules('markerEnd="url(#abc)"')).toEqual([]);
    expect(rules('<a href="#add">x</a>')).toEqual([]);
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
