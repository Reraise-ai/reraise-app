// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { expect, it } from 'vitest';
import { isTrainingEligible } from './index.js';

it('is opt-in: absent or false means not eligible', () => {
  expect(isTrainingEligible({})).toBe(false);
  expect(isTrainingEligible({ training: false })).toBe(false);
  expect(isTrainingEligible({ training: true })).toBe(true);
});
