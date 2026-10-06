// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

export { createLocalStateStore, type LocalStateOptions } from './store.js';
export {
  assertStateDirSafe,
  resolveStateDir,
  type ResolveStateDirOptions,
  type StateDirSafetyOptions,
} from './state-dir.js';
export { DENY_ALL_RULES, buildGateRules, loadGateRulesFile } from './gate-rules.js';
export {
  DEFAULT_GATE_LOG_KEEP,
  DEFAULT_GATE_LOG_MAX_BYTES,
  GateLog,
  formatGateLogLine,
  type GateLogOptions,
} from './gate-log.js';
export { atomicWriteFile, renameWithRetry, type FsOps } from './fs-util.js';
export { createUlidFactory, ULID_PATTERN } from './ulid.js';
export { isLocalStateError, localStateError } from './errors.js';
