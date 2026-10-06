// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Knowledge and Write-back Receipts (ADR-0039). A receipt holds ids, hashes, codes and times
// only, never content; its `hash` is the JCS hash of the receipt without `hash` (ADR-0034).
// Every receipt this module returns is validated against its contract schema, so a field that
// could carry content cannot slip in.

import { canonicalJson, computeContentHash, hashJcs, sha256 } from '@worldbuilder/core';
import type {
  AgentAuthor,
  CardDraft,
  ContextPackage,
  KnowledgeReceipt,
  WriteBackNotNeeded,
  WriteBackReceipt,
} from '@worldbuilder/core';
import { assertContract } from './validate.js';

export type Receipt = KnowledgeReceipt | WriteBackReceipt;

/** The JCS hash of a receipt (or any object) without its `hash` member. */
export function selfHash(value: object): string {
  const rest: Record<string, unknown> = { ...value };
  delete rest['hash'];
  return hashJcs(rest);
}

/** Minimum length of the device receipt key in bytes (ADR-0039). */
export const RECEIPT_KEY_BYTES = 32;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA256 (RFC 2104) over the core SHA-256. */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);
  const inner = new Uint8Array(64 + data.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i]! ^ 0x36;
    outer[i] = block[i]! ^ 0x5c;
  }
  inner.set(data, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

/**
 * Keyed hash of the task text: `hmac-sha256:` + HMAC-SHA256 with the device receipt key over
 * the UTF-8 JCS serialisation of the text. An unkeyed hash would let anyone holding a receipt
 * confirm a guessed task text; the key never leaves the device (ADR-0039).
 */
export function queryHash(task: string, key: Uint8Array): string {
  if (key.length < RECEIPT_KEY_BYTES) {
    throw new Error(`the receipt key must have at least ${RECEIPT_KEY_BYTES} bytes`);
  }
  return `hmac-sha256:${hex(hmacSha256(key, new TextEncoder().encode(canonicalJson(task))))}`;
}

/** Add the self hash to an unsealed receipt. */
function seal<T extends Receipt>(unsealed: Omit<T, 'hash'>): T {
  return { ...unsealed, hash: selfHash(unsealed) } as T;
}

/** The part of a context package a Knowledge Receipt is derived from. */
export type ConsultedPackage = Pick<ContextPackage, 'id' | 'items'> &
  Partial<Pick<ContextPackage, 'confirmationRequired' | 'transfer'>>;

export interface KnowledgeReceiptInput {
  readonly receiptId: string;
  /** From the connection, never from tool input. */
  readonly agent: AgentAuthor;
  /** From the connection. */
  readonly target: 'local_model' | 'cloud_model';
  readonly taskRef: string;
  /** Hashed into `queryHash`; never stored. */
  readonly task: string;
  /** The device receipt key (`<state>/receipt-key`); never stored in a receipt. */
  readonly queryKey: Uint8Array;
  readonly worldId: string;
  readonly lageId?: string;
  /** The gate-cleared package the consult returned. */
  readonly package: ConsultedPackage;
  readonly at: string;
}

/**
 * The receipt of one consult. `result` follows from the package: `confirmation_required` when
 * a cloud connection must wait for a confirmed transfer, `cards` when it delivered items
 * (`cardIds` lists exactly them), `nothing_found` otherwise.
 */
export function createKnowledgeReceipt(input: KnowledgeReceiptInput): KnowledgeReceipt {
  const pkg = input.package;
  const cardIds = pkg.items.map((item) => item.card.id);
  const result = pkg.confirmationRequired
    ? 'confirmation_required'
    : cardIds.length > 0
      ? 'cards'
      : 'nothing_found';
  const transferId = pkg.confirmationRequired?.transferId ?? pkg.transfer?.transferId;
  const receipt = seal<KnowledgeReceipt>({
    receiptId: input.receiptId,
    kind: 'knowledge',
    agent: input.agent,
    taskRef: input.taskRef,
    queryHash: queryHash(input.task, input.queryKey),
    worldId: input.worldId,
    ...(input.lageId !== undefined ? { lageId: input.lageId } : {}),
    target: input.target,
    packageId: pkg.id,
    result,
    cardIds: result === 'cards' ? cardIds : [],
    ...(transferId !== undefined ? { transferId } : {}),
    at: input.at,
  });
  assertContract('knowledge-receipt.schema.json', receipt, 'knowledge receipt');
  return receipt;
}

interface WriteBackBase {
  readonly receiptId: string;
  readonly agent: AgentAuthor;
  readonly taskRef: string;
  readonly consultReceiptId?: string;
  readonly at: string;
}

export type WriteBackReceiptInput =
  | (WriteBackBase & {
      /** The pending proposal the write-back created and the draft it carries. */
      readonly proposalId: string;
      readonly draft: CardDraft;
    })
  | (WriteBackBase & { readonly notNeeded: WriteBackNotNeeded });

/** The receipt of one write-back decision: a proposed card, or a coded "not needed". */
export function createWriteBackReceipt(input: WriteBackReceiptInput): WriteBackReceipt {
  const base = {
    receiptId: input.receiptId,
    kind: 'write_back' as const,
    agent: input.agent,
    taskRef: input.taskRef,
    ...(input.consultReceiptId !== undefined ? { consultReceiptId: input.consultReceiptId } : {}),
  };
  const receipt =
    'notNeeded' in input
      ? seal<WriteBackReceipt>({
          ...base,
          result: 'not_needed',
          reason: input.notNeeded.reason,
          ...(input.notNeeded.coveredBy !== undefined
            ? { coveredBy: input.notNeeded.coveredBy }
            : {}),
          at: input.at,
        })
      : seal<WriteBackReceipt>({
          ...base,
          result: 'proposed',
          proposalId: input.proposalId,
          draftHash: computeContentHash(input.draft),
          at: input.at,
        });
  assertContract('write-back-receipt.schema.json', receipt, 'write-back receipt');
  return receipt;
}

/** Is the receipt's `hash` the hash of its content? */
export function receiptHashMatches(receipt: Receipt): boolean {
  return receipt.hash === selfHash(receipt);
}
