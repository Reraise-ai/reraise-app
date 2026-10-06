// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectIds, findBrokenAnchors } from './check-doc-anchors.mjs';

function site(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'anchors-'));
  for (const [name, html] of Object.entries(files)) {
    const full = path.join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, html);
  }
  return dir;
}

describe('check-doc-anchors', () => {
  it('collects ids', () => {
    expect([...collectIds('<h2 id="a">x</h2><p id="b">')]).toEqual(['a', 'b']);
  });

  it('accepts existing anchors on the same and on other pages', () => {
    const dir = site({
      'a.html': '<h2 id="one">1</h2><a href="#one">x</a><a href="/Worldbuilder/b#two">y</a>',
      'b.html': '<h2 id="two">2</h2>',
    });
    expect(findBrokenAnchors(dir)).toEqual([]);
  });

  it('reports missing anchors', () => {
    const dir = site({
      'a.html': '<a href="#nope">x</a><a href="/Worldbuilder/b#nope2">y</a>',
      'b.html': '<h2 id="two">2</h2>',
    });
    expect(findBrokenAnchors(dir).map((b) => b.href)).toEqual(['#nope', '/Worldbuilder/b#nope2']);
  });

  it('reports links to missing pages, such as a README page that is not built', () => {
    const dir = site({
      'a.html':
        '<a href="/Worldbuilder/adr/README">adr</a><a href="/Worldbuilder/adr/">ok</a><a href="https://example.org/x">ext</a>',
      'adr/index.html': '<h1 id="x">x</h1>',
    });
    expect(findBrokenAnchors(dir)).toEqual([
      { file: 'a.html', href: '/Worldbuilder/adr/README', reason: 'missing page' },
    ]);
  });
});
