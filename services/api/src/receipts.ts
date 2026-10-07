// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The device side of the knowledge loop (ADR-0039, ADR-0040): the receipt key and the
// hash-chained receipt log in the state directory. The service is the only writer; agents
// never touch these files. The log is opened (and its whole chain verified) on first use and
// again after a failure, so a broken log is never extended and a consult is refused rather than
// answered without a receipt.

import {
  RECEIPT_LOG_FILE,
  ReceiptLog,
  checkChain,
  fileReceiptLogPort,
  loadOrCreateReceiptKey,
  type ChainCheck,
  type Receipt,
} from '@worldbuilder/knowledge-loop';
import path from 'node:path';
import { HttpError } from './problem.js';

export class ReceiptStore {
  private log: Promise<ReceiptLog> | undefined;
  private key: Promise<Uint8Array> | undefined;
  private readonly port;

  constructor(
    private readonly stateDir: string,
    private readonly now: () => Date,
  ) {
    this.port = fileReceiptLogPort(path.join(stateDir, RECEIPT_LOG_FILE));
  }

  /** The device receipt key (`<state>/receipt-key`, created owner-only on first use). */
  queryKey(): Promise<Uint8Array> {
    this.key ??= loadOrCreateReceiptKey(this.stateDir).catch((e: unknown) => {
      this.key = undefined;
      throw e;
    });
    return this.key;
  }

  /** The writer; throws a 503 problem when the log is broken (repair is a human act). */
  private open(): Promise<ReceiptLog> {
    this.log ??= ReceiptLog.open(this.port, this.now).catch((e: unknown) => {
      this.log = undefined;
      throw new HttpError(
        503,
        `the receipt log cannot be used: ${e instanceof Error ? e.message : 'unreadable'}`,
      );
    });
    return this.log;
  }

  /** Make sure receipts can be written, before any content is prepared for the caller. */
  async ready(): Promise<void> {
    await this.open();
    await this.queryKey();
  }

  async append(receipt: Receipt): Promise<void> {
    await (await this.open()).append(receipt);
  }

  /** The current chain check of the log file, for the metrics. */
  async chain(): Promise<ChainCheck> {
    return checkChain(await this.port.readLines());
  }
}
