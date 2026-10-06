// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Conformance kit for DisclosureGate implementations (ADR-0008, ADR-0012, ADR-0031).

import type {
  Card,
  DisclosureGate,
  DisclosureTarget,
  DisclosureTransfer,
  GateRuleFragment,
} from '@worldbuilder/core';
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
  /** The `configured` rules plus an adapter fragment; must throw if the fragment allows. */
  withFragment(fragment: GateRuleFragment): DisclosureGate;
  readonly card: Card;
  readonly deniedCard: Card;
  /** A card no rule matches. */
  readonly otherCard: Card;
}

/** Builds fresh gates that read the time from `now`, so the kit can test expiry. */
export type DisclosureGateFactory = (now: () => Date) => DisclosureGateHarness;

const TARGETS: readonly DisclosureTarget[] = ['screen', 'local_model', 'cloud_model', 'demo'];
const request = { question: 'Conformance?', options: ['yes', 'no'] };
const SESSION = 'session-a';
const FIVE_MINUTES = 5 * 60 * 1000;

const codeOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: unknown }).code;
  }
  return 'no error';
};

/** Bits of entropy carried by a base64url token. */
const tokenBits = (token: string) => Math.floor(token.replace(/=+$/, '').length * 6);

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
    const confirm = (gate: DisclosureGate, t: DisclosureTransfer, sessionId = SESSION) =>
      gate.confirm({
        transferId: t.transferId,
        payloadHash: t.payloadHash,
        sessionId,
        currentEnvelope: t.preview,
      });

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

    it('rejects an adapter fragment that allows, and lets a deny fragment narrow', () => {
      const { withFragment, card } = setup();
      const allow: GateRuleFragment = {
        source: 'conformance-adapter',
        rules: [{ id: 'widen', effect: 'allow' as 'deny', targets: ['cloud_model'], match: {} }],
      };
      expect(() => withFragment(allow)).toThrow();
      const narrowed = withFragment({
        source: 'conformance-adapter',
        rules: [
          { id: 'narrow', effect: 'deny', targets: ['local_model'], match: { ids: [card.id] } },
        ],
      });
      expect(narrowed.decide({ kind: 'card', card }, 'local_model').decision).toBe('deny');
      expect(narrowed.decide({ kind: 'card', card }, 'screen').decision).toBe('allow');
    });

    it('never discloses stance data beyond the screen, whatever the rules say', () => {
      const { configured, card } = setup();
      const transfer = previewOf(configured, [card]);
      const confirmation = confirm(configured, transfer);
      const ref = configured.redeem({
        token: confirmation.token,
        sessionId: SESSION,
        envelope: transfer.preview,
      });
      expect(configured.decide({ kind: 'stance', card }, 'screen').decision).toBe('allow');
      for (const target of ['local_model', 'cloud_model', 'demo'] as const) {
        expect(configured.decide({ kind: 'stance', card }, target, ref).decision, target).toBe(
          'deny',
        );
      }
    });

    it('previews exactly the cleared cards, hashed with RFC 8785, for 5 minutes', () => {
      const { configured, card, deniedCard, otherCard } = setup();
      const transfer = previewOf(configured, [card, deniedCard, otherCard]);
      expect(transfer.cardIds).toEqual([card.id]);
      expect(transfer.preview.objects.map((c) => c.id)).toEqual([card.id]);
      expect(transfer.preview.target).toBe('cloud_model');
      expect(transfer.payloadHash).toBe(computePayloadHash(transfer.preview));
      expect(Date.parse(transfer.expiresAt) - Date.parse(transfer.createdAt)).toBe(FIVE_MINUTES);
    });

    it('releases cloud content only through a confirmed, consumed single-use token', () => {
      const { configured, card, otherCard } = setup();
      const denied = configured.decide({ kind: 'card', card }, 'cloud_model');
      expect(denied.decision).toBe('deny');
      expect(denied.confirmationRequired).toBe(true);

      const transfer = previewOf(configured, [card]);
      const confirmation = confirm(configured, transfer);
      expect(confirmation.confirmedBy).toBe('human');
      expect(confirmation.payloadHash).toBe(transfer.payloadHash);
      expect(tokenBits(confirmation.token)).toBeGreaterThanOrEqual(128);
      const unsent = {
        transferId: confirmation.transferId,
        payloadHash: confirmation.payloadHash,
        cardIds: confirmation.cardIds,
        confirmedAt: confirmation.confirmedAt,
      };
      // Confirmed but not yet sent: still denied.
      expect(configured.decide({ kind: 'card', card }, 'cloud_model', unsent).decision).toBe(
        'deny',
      );

      const ref = configured.redeem({
        token: confirmation.token,
        sessionId: SESSION,
        envelope: transfer.preview,
      });
      expect(ref).not.toHaveProperty('token');
      const allowed = configured.decide({ kind: 'card', card }, 'cloud_model', ref);
      expect(allowed.decision).toBe('allow');
      expect(allowed.confirmation).toEqual(ref);
      expect(
        configured.decide({ kind: 'card', card: otherCard }, 'cloud_model', ref).decision,
      ).toBe('deny');
    });

    it('rejects a confirm whose previewed or current hash differs, and a second confirm', () => {
      const { configured, card } = setup();
      const t = previewOf(configured, [card]);
      const changed = { ...t.preview, connectorId: 'other-engine' };
      expect(
        codeOf(() =>
          configured.confirm({
            transferId: t.transferId,
            payloadHash: t.payloadHash,
            sessionId: SESSION,
            currentEnvelope: changed,
          }),
        ),
      ).toBe('mismatch');
      expect(
        codeOf(() =>
          configured.confirm({
            transferId: t.transferId,
            payloadHash: `sha256:${'0'.repeat(64)}`,
            sessionId: SESSION,
            currentEnvelope: t.preview,
          }),
        ),
      ).toBe('mismatch');
      expect(
        codeOf(() =>
          configured.confirm({
            transferId: '01M1HA4MC0T8585XX5H0E6NVRP',
            payloadHash: t.payloadHash,
            sessionId: SESSION,
            currentEnvelope: t.preview,
          }),
        ),
      ).toBe('unknown');
      confirm(configured, t);
      expect(codeOf(() => confirm(configured, t))).toBe('replayed');
    });

    it('rejects an expired transfer and an expired token', () => {
      const { configured, card, advance } = setup();
      const t1 = previewOf(configured, [card]);
      advance(FIVE_MINUTES);
      expect(codeOf(() => confirm(configured, t1))).toBe('expired');
      const t2 = previewOf(configured, [card]);
      const c2 = confirm(configured, t2);
      advance(FIVE_MINUTES);
      expect(
        codeOf(() =>
          configured.redeem({ token: c2.token, sessionId: SESSION, envelope: t2.preview }),
        ),
      ).toBe('expired');
    });

    it('consumes a token once, only from its session and only for the confirmed envelope', () => {
      const { configured, card } = setup();
      const t = previewOf(configured, [card]);
      const c = confirm(configured, t);
      expect(
        codeOf(() =>
          configured.redeem({ token: c.token, sessionId: 'session-b', envelope: t.preview }),
        ),
      ).toBe('session');
      const edited = { ...t.preview, request: { ...t.preview.request, question: 'Edited?' } };
      expect(
        codeOf(() => configured.redeem({ token: c.token, sessionId: SESSION, envelope: edited })),
      ).toBe('mismatch');
      // The failed send consumed the token: a second use fails.
      expect(
        codeOf(() =>
          configured.redeem({ token: c.token, sessionId: SESSION, envelope: t.preview }),
        ),
      ).toBe('replayed');

      const t2 = previewOf(configured, [card]);
      const c2 = confirm(configured, t2);
      configured.redeem({ token: c2.token, sessionId: SESSION, envelope: t2.preview });
      expect(
        codeOf(() =>
          configured.redeem({ token: c2.token, sessionId: SESSION, envelope: t2.preview }),
        ),
      ).toBe('replayed');
      expect(
        codeOf(() =>
          configured.redeem({
            token: 'never-issued-token-000000',
            sessionId: SESSION,
            envelope: t2.preview,
          }),
        ),
      ).toBe('unknown');
    });

    it('denies forged confirmation references', () => {
      const { configured, card } = setup();
      const transfer = previewOf(configured, [card]);
      const forged = {
        transferId: transfer.transferId,
        payloadHash: transfer.payloadHash,
        cardIds: [card.id],
        confirmedAt: '2026-10-06T00:00:00Z',
      };
      expect(configured.decide({ kind: 'card', card }, 'cloud_model', forged).decision).toBe(
        'deny',
      );
    });
  });
}
