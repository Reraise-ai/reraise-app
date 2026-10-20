// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { embedOptions } from './embed.js';

describe('embedOptions', () => {
  it('reads embed=1 and a light or dark theme', () => {
    expect(embedOptions('?embed=1&theme=light')).toEqual({ embed: true, theme: 'light' });
    expect(embedOptions('?theme=dark')).toEqual({ embed: false, theme: 'dark' });
  });

  it('ignores other values', () => {
    expect(embedOptions('')).toEqual({ embed: false });
    expect(embedOptions('?embed=true&theme=blue')).toEqual({ embed: false });
    expect(embedOptions('?embed=0')).toEqual({ embed: false });
  });
});
