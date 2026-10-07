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
import { stat } from 'node:fs/promises';
import { HttpError } from './problem.js';
import { Mutex } from './util.js';

/** What the file looked like after this writer's last append (or at open). */
type Signature = string;

/** The receipt log is broken or unreadable: a 503 with its own problem type. */
export class ReceiptLogError extends HttpError {
  constructor(detail: string) {
    super(503, detail, 'receipt-log-unavailable');
  }
}

export class ReceiptStore {
  private log: Promise<ReceiptLog> | undefined;
  private signature: Signature | undefined;
  private key: Promise<Uint8Array> | undefined;
  private readonly port;
  private readonly file: string;
  private readonly lock = new Mutex();

  constructor(
    private readonly stateDir: string,
    private readonly now: () => Date,
  ) {
    this.file = path.join(stateDir, RECEIPT_LOG_FILE);
    this.port = fileReceiptLogPort(this.file);
  }

  /** The device receipt key (`<state>/receipt-key`, created owner-only on first use). */
  queryKey(): Promise<Uint8Array> {
    this.key ??= loadOrCreateReceiptKey(this.stateDir).catch((e: unknown) => {
      this.key = undefined;
      throw e;
    });
    return this.key;
  }

  private async signatureOfFile(): Promise<Signature> {
    try {
      const info = await stat(this.file);
      return `${info.size}:${info.mtimeMs}:${info.ino}`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      throw e;
    }
  }

  /**
   * The writer, valid for the file as it is now. If the file is not what this writer last wrote
   * (edited, damaged, replaced or moved aside by someone) the writer is opened again, which
   * verifies the whole chain: a broken log is a 503 and nothing is delivered; a missing file
   * starts a fresh chain at seq 0 (ADR-0040).
   */
  private async current(): Promise<ReceiptLog> {
    const seen = await this.signatureOfFile();
    if (this.log !== undefined && this.signature !== seen) this.log = undefined;
    if (this.log === undefined) {
      const opened = ReceiptLog.open(this.port, this.now).catch((e: unknown) => {
        this.log = undefined;
        throw new ReceiptLogError(
          `the receipt log cannot be used: ${e instanceof Error ? e.message : 'unreadable'}`,
        );
      });
      this.log = opened;
      this.signature = seen;
    }
    return this.log;
  }

  /** Make sure receipts can be written, before any content is prepared for the caller. */
  async ready(): Promise<void> {
    await this.lock.run(() => this.current());
    await this.queryKey();
  }

  async append(receipt: Receipt): Promise<void> {
    await this.lock.run(async () => {
      const log = await this.current();
      await log.append(receipt);
      this.signature = await this.signatureOfFile();
    });
  }

  /** The current chain check of the log file, for the metrics. */
  async chain(): Promise<ChainCheck> {
    return checkChain(await this.port.readLines());
  }
}
