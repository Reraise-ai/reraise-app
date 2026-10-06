// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Conformance kit for DisclosureGate implementations (ADR-0008, ADR-0012, ADR-0031).

import type { Card, DisclosureGate, DisclosureTarget } from '@worldbuilder/core';
import { computePayloadHash } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';

export interface DisclosureGateHarness {
  /** A gate without any rule. */
  readonly empty: DisclosureGate;
  /**
   * A gate whose allow rules match `card` and `deniedCard` for every target, and whose deny
   * rule also matches `deniedCard` for every target.
   */
  readonly configured: DisclosureGate;
  readonly card: Card;
  readonly deniedCard: Card;
  /** A card no rule matches. */
  readonly otherCard: Card;
}

/** Builds fresh gates that read the time from `now`, so the kit can test expiry. */
export type DisclosureGateFactory = (now: () => Date) => DisclosureGateHarness;

const TARGETS: readonly DisclosureTarget[] = ['screen', 'local_model', 'cloud_model', 'demo'];
const request = { question: 'Conformance?', options: ['yes', 'no'] };

const codeOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: unknown }).code;
  }
  return 'no error';
};

export function describeDisclosureGateConformance(
  name: string,
  factory: DisclosureGateFactory,
): void {
  describe(`DisclosureGate conformance: ${name}`, () => {
    const setup = () => {
      let time = Date.parse('2026-10-06T10:00:00Z');
      const harness = factory(() => new Date(time));
      return { ...harness, advance: (ms: number) => (time += ms) };
    };
    const previewOf = (gate: DisclosureGate, cards: Card[]) =>
      gate.preview({ connectorId: 'conformance', purpose: 'level1', request, cards });

    it.each(TARGETS)('denies %s by default (no rule)', (target) => {
      const { empty, card } = setup();
      const decision = empty.decide({ kind: 'card', card }, target);
      expect(decision.decision).toBe('deny');
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(decision.subject).toEqual({ kind: 'card', cardId: card.id });
      expect(decision.target).toBe(target);
    });

    it('denies a card that no rule matches, even when rules exist', () => {
      const { configured, otherCard } = setup();
      for (const target of TARGETS) {
        expect(configured.decide({ kind: 'card', card: otherCard }, target).decision).toBe('deny');
      }
    });

    it('lets a matching deny rule win over a matching allow rule', () => {
      const { configured, deniedCard } = setup();
      for (const target of TARGETS) {
        expect(configured.decide({ kind: 'card', card: deniedCard }, target).decision).toBe('deny');
      }
    });

    it('allows a matching card for screen, local models and demos', () => {
      const { configured, card } = setup();
      for (const target of ['screen', 'local_model', 'demo'] as const) {
        expect(configured.decide({ kind: 'card', card }, target).decision).toBe('allow');
      }
    });

    it('never discloses stance data beyond the screen, whatever the rules say', () => {
      const { configured, card } = setup();
      const transfer = previewOf(configured, [card]);
      const confirmation = configured.confirm(transfer.transferId, transfer.payloadHash);
      expect(configured.decide({ kind: 'stance', card }, 'screen').decision).toBe('allow');
      for (const target of ['local_model', 'cloud_model', 'demo'] as const) {
        const decision = configured.decide({ kind: 'stance', card }, target, confirmation);
        expect(decision.decision, target).toBe('deny');
      }
    });

    it('previews exactly the cleared cards, hashed with RFC 8785', () => {
      const { configured, card, deniedCard, otherCard } = setup();
      const transfer = previewOf(configured, [card, deniedCard, otherCard]);
      expect(transfer.cardIds).toEqual([card.id]);
      expect(transfer.preview.objects.map((c) => c.id)).toEqual([card.id]);
      expect(transfer.preview.target).toBe('cloud_model');
      expect(transfer.payloadHash).toBe(computePayloadHash(transfer.preview));
      expect(Date.parse(transfer.expiresAt)).toBeGreaterThan(Date.parse(transfer.createdAt));
    });

    it('denies cloud_model until the user confirms this payload', () => {
      const { configured, card, otherCard } = setup();
      const denied = configured.decide({ kind: 'card', card }, 'cloud_model');
      expect(denied.decision).toBe('deny');
      expect(denied.confirmationRequired).toBe(true);

      const transfer = previewOf(configured, [card]);
      const confirmation = configured.confirm(transfer.transferId, transfer.payloadHash);
      expect(confirmation.confirmedBy).toBe('human');
      expect(confirmation.payloadHash).toBe(transfer.payloadHash);
      const allowed = configured.decide({ kind: 'card', card }, 'cloud_model', confirmation);
      expect(allowed.decision).toBe('allow');
      expect(allowed.confirmation).toEqual(confirmation);
      const outside = configured.decide(
        { kind: 'card', card: otherCard },
        'cloud_model',
        confirmation,
      );
      expect(outside.decision).toBe('deny');
    });

    it('rejects a mismatching hash (409), a replay (409) and an expired transfer (410)', () => {
      const { configured, card, advance } = setup();
      const t1 = previewOf(configured, [card]);
      expect(codeOf(() => configured.confirm(t1.transferId, `sha256:${'0'.repeat(64)}`))).toBe(
        'mismatch',
      );
      expect(codeOf(() => configured.confirm('01M1HA4MC0T8585XX5H0E6NVRP', t1.payloadHash))).toBe(
        'unknown',
      );
      configured.confirm(t1.transferId, t1.payloadHash);
      expect(codeOf(() => configured.confirm(t1.transferId, t1.payloadHash))).toBe('replayed');

      const t2 = previewOf(configured, [card]);
      advance(Date.parse(t2.expiresAt) - Date.parse(t2.createdAt));
      expect(codeOf(() => configured.confirm(t2.transferId, t2.payloadHash))).toBe('expired');
    });

    it('denies forged confirmations', () => {
      const { configured, card } = setup();
      const transfer = previewOf(configured, [card]);
      const forged = {
        transferId: transfer.transferId,
        payloadHash: transfer.payloadHash,
        cardIds: [card.id],
        confirmedBy: 'human' as const,
        confirmedAt: '2026-10-06T00:00:00Z',
      };
      expect(configured.decide({ kind: 'card', card }, 'cloud_model', forged).decision).toBe(
        'deny',
      );
    });
  });
}
