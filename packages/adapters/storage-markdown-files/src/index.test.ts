// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { expect, it } from 'vitest';
import { ADAPTER_ID } from './index.js';

it('identifies itself as the markdown-files reference adapter', () => {
  expect(ADAPTER_ID).toBe('markdown-files');
});
