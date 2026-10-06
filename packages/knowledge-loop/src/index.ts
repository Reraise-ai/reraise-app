// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The knowledge loop (ADR-0039 to ADR-0043): receipts, the receipt log and its verifier, usage
// metrics, memory routing and the atlas digest. Pure functions; file I/O only in the file port
// and the wb command line.

export {
  createKnowledgeReceipt,
  createWriteBackReceipt,
  queryHash,
  receiptHashMatches,
  selfHash,
  type ConsultedPackage,
  type KnowledgeReceiptInput,
  type Receipt,
  type WriteBackReceiptInput,
} from './receipts.js';
export {
  GENESIS,
  RECEIPT_LOG_FILE,
  ReceiptLog,
  buildEntry,
  checkChain,
  formatEntry,
  splitLogLines,
  type ChainCheck,
  type ChainCheckOptions,
  type ChainProblem,
  type ChainProblemCode,
  type ReceiptLogPort,
} from './log.js';
export { fileReceiptLogPort } from './fs-port.js';
export {
  DEFAULT_MAX_AGE_HOURS,
  DEFAULT_SKEW_SECONDS,
  verifyAgainstChain,
  verifyReceipts,
  type ReceiptProblem,
  type ReceiptProblemCode,
  type ReceiptSlot,
  type TaskVerification,
  type VerificationReport,
  type VerifyOptions,
} from './verify.js';
export {
  DEFAULT_TARGETS,
  computeUsageMetrics,
  countByAgent,
  hasOutcome,
  isoWeekOf,
  isoWeekRange,
  type TargetId,
  type TimeWindow,
  type UsageLedger,
  type UsageMetricsOptions,
} from './metrics.js';
export {
  CLASSIFIER,
  DURABLE_WORDS,
  TRANSIENT_WORDS,
  memorySignals,
  routeMemory,
  type RouteOptions,
  type Signal,
} from './route.js';
export {
  UNASSIGNED_PAGE_ID,
  buildDigest,
  cardsInScope,
  checkDigestPage,
  inAtlas,
  lineText,
  renderDigestMarkdown,
  worldPageId,
  type DigestOptions,
  type DigestStaleness,
} from './digest.js';
export { EXIT, parseTaskRecord, runCli, type CliIo } from './cli.js';
export { assertContract, validateContract, type ValidationResult } from './validate.js';
