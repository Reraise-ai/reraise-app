// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

export const CONFORMANCE_KIT_VERSION = '0.0.0';

export { describeStorageAdapterConformance } from './storage.js';
export type { StorageAdapterFactory, StorageAdapterHarness } from './storage.js';
export { describeDisclosureGateConformance } from './disclosure-gate.js';
export type {
  DisclosureGateConfig,
  DisclosureGateFactory,
  DisclosureGateHarness,
} from './disclosure-gate.js';
export {
  describeLevel1EngineConformance,
  level1PredictionProblems,
  releaseOf,
  releaseOfEnvelope,
} from './level1-engine.js';
export type { Level1EngineFactory, Level1EngineHarness } from './level1-engine.js';
export { createFixedLevel1Engine, releaseCoversRequest } from './level1-fake.js';
export type { FixedLevel1EngineOptions } from './level1-fake.js';
export { MemoryStorageAdapter, MemoryStore, memoryHarness } from './memory-adapter.js';
