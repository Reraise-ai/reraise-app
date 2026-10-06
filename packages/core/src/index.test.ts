// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import { CARD_LAYERS, isCardLayer } from './index.js';

describe('card layers', () => {
  it('has exactly the three epistemic layers', () => {
    expect(CARD_LAYERS).toEqual(['evidenced', 'said', 'experience']);
  });

  it('does not treat believed as a layer (it is a stance overlay)', () => {
    expect(isCardLayer('believed')).toBe(false);
  });

  it('accepts known layers and rejects non-strings', () => {
    expect(isCardLayer('said')).toBe(true);
    expect(isCardLayer(42)).toBe(false);
  });
});
