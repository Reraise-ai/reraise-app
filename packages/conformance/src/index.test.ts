// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { expect, it } from 'vitest';
import {
  CONFORMANCE_KIT_VERSION,
  describeStorageAdapterConformance,
  memoryHarness,
} from './index.js';

it('exposes a semver version', () => {
  expect(CONFORMANCE_KIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

// M0: the kit runs against the in-memory fake, once per id scheme (ADR-0005, ADR-0023).
describeStorageAdapterConformance('in-memory fake, native ids', async () =>
  memoryHarness('native'),
);
describeStorageAdapterConformance('in-memory fake, derived ids', async () =>
  memoryHarness('derived'),
);
