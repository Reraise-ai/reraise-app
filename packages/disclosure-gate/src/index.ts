// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Reference DisclosureGate (ADR-0012, ADR-0031): default deny, deny wins, per card and per
// target, with rules as data (`schemas/gate-rules.schema.json`). Cloud transfers are
// previewed, hashed (RFC 8785) and confirmed once by the human before they expire. Decisions
// are logged by the caller without card content.

import type {
  Card,
  DisclosureConfirmation,
  DisclosureDecision,
  DisclosureGate,
  DisclosureItem,
  DisclosureTarget,
  DisclosureTransfer,
  GateRule,
  GateRules,
  TransferErrorCode,
} from '@worldbuilder/core';
import { computePayloadHash, encodeUlid, parseUri } from '@worldbuilder/core';

export type { DisclosureTarget } from '@worldbuilder/core';

export interface DisclosureGateOptions {
  /** Rules as configured (validated against gate-rules.schema.json). */
  readonly rules?: GateRules;
  /** Store instance ids whose configuration says `synthetic: true`. */
  readonly syntheticStores?: readonly string[];
  /** How long a previewed transfer can be confirmed. Default 10 minutes. */
  readonly transferTtlMs?: number;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

function randomUlid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = bytes[0]! & 0x7f;
  return encodeUlid(bytes);
}

class GateTransferError extends Error {
  constructor(
    readonly code: TransferErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const anyOf = <T>(wanted: readonly T[] | undefined, actual: readonly T[]) =>
  wanted === undefined || wanted.some((w) => actual.includes(w));
const oneOf = <T>(wanted: readonly T[] | undefined, actual: T | undefined) =>
  wanted === undefined || (actual !== undefined && wanted.includes(actual));

/** True if every criterion of the rule holds for the card. */
export function ruleMatches(
  rule: GateRule,
  card: Card,
  syntheticStores: readonly string[],
): boolean {
  const m = rule.match;
  return (
    oneOf(m.visibility, card.visibility ?? 'private') &&
    oneOf(m.class, card.class) &&
    oneOf(m.collection, card.collection) &&
    oneOf(m.type, card.type) &&
    oneOf(m.ids, card.id) &&
    anyOf(m.worlds, card.worlds ?? []) &&
    anyOf(m.tags, card.tags ?? []) &&
    (m.syntheticStore === undefined || syntheticStores.includes(parseUri(card.uri).storeInstanceId))
  );
}

export function createDisclosureGate(options: DisclosureGateOptions = {}): DisclosureGate {
  const rules = options.rules?.rules ?? [];
  const synthetic = options.syntheticStores ?? [];
  const ttl = options.transferTtlMs ?? 10 * 60 * 1000;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUlid;
  const transfers = new Map<string, DisclosureTransfer>();
  const confirmations = new Map<string, DisclosureConfirmation>();

  const result = (
    item: DisclosureItem,
    target: DisclosureTarget,
    decision: 'allow' | 'deny',
    reason: string,
    extra: Partial<DisclosureDecision> = {},
  ): DisclosureDecision => ({
    subject: { kind: item.kind, cardId: item.card.id },
    target,
    decision,
    reason,
    ...extra,
    decidedAt: now().toISOString(),
  });

  /** The rule that decides: a matching deny rule wins, else a matching allow rule. */
  const decidingRule = (card: Card, target: DisclosureTarget) => {
    const matching = rules.filter(
      (r) => r.targets.includes(target) && ruleMatches(r, card, synthetic),
    );
    return matching.find((r) => r.effect === 'deny') ?? matching.find((r) => r.effect === 'allow');
  };

  return {
    decide(item, target, confirmation) {
      if (item.kind === 'stance' && target !== 'screen') {
        return result(item, target, 'deny', 'stance data never leaves the screen');
      }
      const rule = decidingRule(item.card, target);
      if (!rule) return result(item, target, 'deny', 'default deny: no allow rule matches');
      if (rule.effect === 'deny') {
        return result(item, target, 'deny', `deny rule ${rule.id}`, { ruleId: rule.id });
      }
      if (target !== 'cloud_model') {
        return result(item, target, 'allow', `allow rule ${rule.id}`, { ruleId: rule.id });
      }
      const stored = confirmation && confirmations.get(confirmation.transferId);
      const confirmed =
        stored !== undefined &&
        stored.payloadHash === confirmation?.payloadHash &&
        stored.confirmedAt === confirmation.confirmedAt &&
        stored.cardIds.includes(item.card.id);
      if (!confirmed) {
        return result(item, target, 'deny', 'cloud transfer needs the user confirmation', {
          ruleId: rule.id,
          confirmationRequired: true,
        });
      }
      return result(item, target, 'allow', `allow rule ${rule.id} and confirmed transfer`, {
        ruleId: rule.id,
        confirmation: stored,
      });
    },

    preview(input) {
      const objects = input.cards.filter((c) => decidingRule(c, 'cloud_model')?.effect === 'allow');
      if (objects.length === 0)
        throw new Error('no card of this transfer is cleared for cloud_model');
      const preview = {
        target: 'cloud_model' as const,
        connectorId: input.connectorId,
        request: input.request,
        objects,
      };
      const created = now();
      const transfer: DisclosureTransfer = {
        transferId: newId(),
        purpose: input.purpose,
        cardIds: objects.map((c) => c.id),
        payloadHash: computePayloadHash(preview),
        preview,
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + ttl).toISOString(),
      };
      transfers.set(transfer.transferId, transfer);
      return transfer;
    },

    confirm(transferId, payloadHash) {
      const transfer = transfers.get(transferId);
      if (!transfer) throw new GateTransferError('unknown', `unknown transfer ${transferId}`);
      if (confirmations.has(transferId)) {
        throw new GateTransferError('replayed', 'this transfer is already confirmed');
      }
      if (now().getTime() >= Date.parse(transfer.expiresAt)) {
        throw new GateTransferError('expired', 'this transfer has expired');
      }
      if (payloadHash !== transfer.payloadHash) {
        throw new GateTransferError('mismatch', 'the payload hash does not match the preview');
      }
      const confirmation: DisclosureConfirmation = {
        transferId,
        payloadHash,
        cardIds: [...transfer.cardIds],
        confirmedBy: 'human',
        confirmedAt: now().toISOString(),
      };
      confirmations.set(transferId, confirmation);
      return confirmation;
    },
  };
}
