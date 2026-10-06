// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { expect, it } from 'vitest';
import { CONFORMANCE_KIT_VERSION } from './index.js';

it('exposes a semver version', () => {
  expect(CONFORMANCE_KIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
