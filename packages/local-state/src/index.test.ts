// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import * as api from './index.js';

describe('public API', () => {
  it('exports the state-dir functions, store factory and loader', () => {
    for (const name of [
      'createLocalStateStore',
      'resolveStateDir',
      'assertStateDirSafe',
      'loadGateRulesFile',
      'buildGateRules',
      'GateLog',
      'atomicWriteFile',
    ]) {
      expect(typeof (api as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(api.DEFAULT_GATE_LOG_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(api.DEFAULT_GATE_LOG_KEEP).toBe(5);
  });
});
