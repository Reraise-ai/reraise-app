// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

export const CONFORMANCE_KIT_VERSION = '0.0.0';

export { describeStorageAdapterConformance } from './storage.js';
export type { StorageAdapterFactory, StorageAdapterHarness } from './storage.js';
export { describeDisclosureGateConformance } from './disclosure-gate.js';
export type { DisclosureGateFactory, DisclosureGateHarness } from './disclosure-gate.js';
export { MemoryStorageAdapter, MemoryStore, memoryHarness } from './memory-adapter.js';
