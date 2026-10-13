// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { layerCounts, layerFigures } from './layerFigures.js';

describe('layerFigures', () => {
  it('keeps the three layers apart, including a layer with nothing in it', () => {
    expect(
      layerFigures([
        { layer: 'evidenced', originRoot: 'wire' },
        { layer: 'said', originRoot: 'briefing' },
      ]),
    ).toEqual([
      { layer: 'evidenced', findings: 1, origins: 1 },
      { layer: 'said', findings: 1, origins: 1 },
      { layer: 'experience', findings: 0, origins: 0 },
    ]);
  });

  it('counts one origin twice only inside its own layer', () => {
    expect(
      layerFigures([
        { layer: 'evidenced', originRoot: 'wire' },
        { layer: 'evidenced', originRoot: 'wire' },
        { layer: 'said', originRoot: 'wire' },
      ]),
    ).toEqual([
      { layer: 'evidenced', findings: 2, origins: 1 },
      { layer: 'said', findings: 1, origins: 1 },
      { layer: 'experience', findings: 0, origins: 0 },
    ]);
  });

  it('lists a card with no layer as unclassified and does not invent a fourth layer otherwise', () => {
    expect(layerFigures([{ originRoot: 'legacy' }])).toEqual([
      { layer: 'evidenced', findings: 0, origins: 0 },
      { layer: 'said', findings: 0, origins: 0 },
      { layer: 'experience', findings: 0, origins: 0 },
      { layer: 'unclassified', findings: 1, origins: 1 },
    ]);
    expect(layerCounts([])).toEqual([
      { layer: 'evidenced', count: 0 },
      { layer: 'said', count: 0 },
      { layer: 'experience', count: 0 },
    ]);
  });
});
