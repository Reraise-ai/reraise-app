// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { expect, it } from 'vitest';
import { decideDefault } from './index.js';

it.each(['screen', 'local_model', 'cloud_model', 'demo'] as const)(
  'denies %s by default',
  (target) => {
    expect(decideDefault(target).decision).toBe('deny');
  },
);
