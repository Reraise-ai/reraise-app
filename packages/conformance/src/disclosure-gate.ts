// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Conformance kit for DisclosureGate implementations (ADR-0008, ADR-0012).

import type { Card, DisclosureGate, DisclosureTarget } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';

export interface DisclosureGateHarness {
  /** A gate without any allow rule. */
  readonly empty: DisclosureGate;
  /** A gate whose rules allow `card` (and only it) for every target. */
  readonly allowAll: DisclosureGate;
  /** The card the `allowAll` rules match. */
  readonly card: Card;
  /** A card no rule matches. */
  readonly otherCard: Card;
}

export type DisclosureGateFactory = () => DisclosureGateHarness;

const TARGETS: readonly DisclosureTarget[] = ['screen', 'local_model', 'cloud_model', 'demo'];

export function describeDisclosureGateConformance(
  name: string,
  factory: DisclosureGateFactory,
): void {
  describe(`DisclosureGate conformance: ${name}`, () => {
    it.each(TARGETS)('denies %s by default (no allow rule)', (target) => {
      const { empty, card } = factory();
      const decision = empty.decide({ kind: 'card', card }, target);
      expect(decision.decision).toBe('deny');
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(decision.subject).toEqual({ kind: 'card', cardId: card.id });
      expect(decision.target).toBe(target);
    });

    it('denies a card that no rule matches, even when rules exist', () => {
      const { allowAll, otherCard } = factory();
      for (const target of TARGETS) {
        expect(allowAll.decide({ kind: 'card', card: otherCard }, target).decision).toBe('deny');
      }
    });

    it('allows a matching card for screen, local models and demos', () => {
      const { allowAll, card } = factory();
      for (const target of ['screen', 'local_model', 'demo'] as const) {
        expect(allowAll.decide({ kind: 'card', card }, target).decision).toBe('allow');
      }
    });

    it('never discloses stance data beyond the screen, whatever the rules say', () => {
      const { allowAll, card } = factory();
      const transfer = allowAll.requestTransfer([card.id], 'context_package');
      const confirmation = allowAll.confirm(transfer.transferId, [card.id]);
      expect(allowAll.decide({ kind: 'stance', card }, 'screen').decision).toBe('allow');
      for (const target of ['local_model', 'cloud_model', 'demo'] as const) {
        const decision = allowAll.decide({ kind: 'stance', card }, target, confirmation);
        expect(decision.decision, target).toBe('deny');
      }
    });

    it('denies cloud_model without the confirmation of this transfer', () => {
      const { allowAll, card, otherCard } = factory();
      const denied = allowAll.decide({ kind: 'card', card }, 'cloud_model');
      expect(denied.decision).toBe('deny');
      expect(denied.confirmationRequired).toBe(true);

      const transfer = allowAll.requestTransfer([card.id], 'context_package');
      expect(transfer.target).toBe('cloud_model');
      expect(transfer.cardIds).toEqual([card.id]);
      const confirmation = allowAll.confirm(transfer.transferId, [card.id]);
      expect(confirmation.confirmedBy).toBe('human');
      const allowed = allowAll.decide({ kind: 'card', card }, 'cloud_model', confirmation);
      expect(allowed.decision).toBe('allow');
      expect(allowed.confirmation).toEqual(confirmation);

      // The confirmation covers exactly the listed cards.
      expect(
        allowAll.decide({ kind: 'card', card: otherCard }, 'cloud_model', confirmation).decision,
      ).toBe('deny');
    });

    it('rejects confirmations that differ from the requested transfer or were forged', () => {
      const { allowAll, card, otherCard } = factory();
      const transfer = allowAll.requestTransfer([card.id], 'export');
      expect(() => allowAll.confirm(transfer.transferId, [card.id, otherCard.id])).toThrow();
      expect(() => allowAll.confirm('01M1HA4MC0T8585XX5H0E6NVRP', [card.id])).toThrow();
      const forged = {
        transferId: transfer.transferId,
        cardIds: [card.id],
        confirmedBy: 'human' as const,
        confirmedAt: '2026-10-06T00:00:00Z',
      };
      expect(allowAll.decide({ kind: 'card', card }, 'cloud_model', forged).decision).toBe('deny');
    });
  });
}
