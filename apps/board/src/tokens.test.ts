// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Every text colour of the board reaches WCAG AA (4.5:1) on both surfaces, in the dark default
// and in the light theme. Before the light theme a host on a light window showed the
// cream "Experience" badge at about 1.2:1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve('apps/board/src/tokens.css'), 'utf8');

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return new Map(
    [...body.matchAll(/(--wb-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

const root = block(':root');
const light = new Map([...root, ...block("[data-wb-theme='light']")]);

function resolve(vars: Map<string, string>, name: string): string {
  const value = vars.get(name);
  if (!value) throw new Error(`no ${name}`);
  const ref = /^var\((--wb-[\w-]+)\)$/.exec(value);
  return ref ? resolve(vars, ref[1]!) : value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = [
  '--wb-text',
  '--wb-text-muted',
  '--wb-accent',
  '--wb-warning',
  '--wb-danger',
  '--wb-color-evidenced',
  '--wb-color-said',
  '--wb-color-experience',
  '--wb-color-believed',
  '--wb-color-agent',
];

describe.each([
  ['dark', root],
  ['light', light],
])('%s theme', (_name, vars) => {
  it.each(TEXT)('%s reaches 4.5:1 on both surfaces', (token) => {
    for (const surface of ['--wb-surface', '--wb-surface-raised']) {
      expect(contrast(resolve(vars, token), resolve(vars, surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on the accent button reaches 4.5:1', () => {
    expect(
      contrast(resolve(vars, '--wb-on-accent'), resolve(vars, '--wb-accent')),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
