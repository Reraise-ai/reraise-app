// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Reference DisclosureGate (ADR-0012): default deny, per card and per target. It holds only
// the contract rules; which cards a user allows is configuration (allow rules), added per
// installation and per adapter. Decisions are logged by the caller without card content.

import type {
  Card,
  DisclosureConfirmation,
  DisclosureDecision,
  DisclosureGate,
  DisclosureItem,
  DisclosureTarget,
  DisclosureTransfer,
} from '@worldbuilder/core';
import { encodeUlid } from '@worldbuilder/core';

export type { DisclosureTarget } from '@worldbuilder/core';

/** An explicit allow rule. Without a matching rule every decision is deny. */
export interface AllowRule {
  readonly id: string;
  readonly target: DisclosureTarget;
  matches(card: Card): boolean;
}

export interface DisclosureGateOptions {
  readonly rules?: readonly AllowRule[];
  readonly now?: () => Date;
  readonly newId?: () => string;
}

function randomUlid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = bytes[0]! & 0x7f;
  return encodeUlid(bytes);
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

export function createDisclosureGate(options: DisclosureGateOptions = {}): DisclosureGate {
  const rules = options.rules ?? [];
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

  return {
    decide(item, target, confirmation) {
      if (item.kind === 'stance' && target !== 'screen') {
        return result(item, target, 'deny', 'stance data never leaves the screen');
      }
      const rule = rules.find((r) => r.target === target && r.matches(item.card));
      if (!rule) return result(item, target, 'deny', 'default deny: no allow rule matches');
      if (target !== 'cloud_model') {
        return result(item, target, 'allow', `allow rule ${rule.id}`, { ruleId: rule.id });
      }
      const stored = confirmation && confirmations.get(confirmation.transferId);
      const confirmed =
        stored !== undefined &&
        stored.confirmedAt === confirmation?.confirmedAt &&
        sameIds(stored.cardIds, confirmation.cardIds) &&
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

    requestTransfer(cardIds, purpose) {
      if (cardIds.length === 0) throw new Error('a transfer lists at least one card');
      const transfer: DisclosureTransfer = {
        transferId: newId(),
        target: 'cloud_model',
        purpose,
        cardIds: [...new Set(cardIds)],
        createdAt: now().toISOString(),
      };
      transfers.set(transfer.transferId, transfer);
      return transfer;
    },

    confirm(transferId, cardIds) {
      const transfer = transfers.get(transferId);
      if (!transfer) throw new Error(`unknown transfer ${transferId}`);
      if (!sameIds(transfer.cardIds, [...new Set(cardIds)])) {
        throw new Error('a confirmation must list exactly the cards of the transfer');
      }
      const confirmation: DisclosureConfirmation = {
        transferId,
        cardIds: [...transfer.cardIds],
        confirmedBy: 'human',
        confirmedAt: now().toISOString(),
      };
      confirmations.set(transferId, confirmation);
      return confirmation;
    },
  };
}
