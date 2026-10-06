// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Conformance kit for DisclosureGate implementations (ADR-0008, ADR-0012, ADR-0031, ADR-0028).

import type {
  Card,
  DisclosureGate,
  DisclosureGrant,
  DisclosurePreviewEnvelope,
  DisclosureTarget,
  DisclosureTransfer,
  TransferRequester,
} from '@worldbuilder/core';
import { computeContentHash, computePayloadHash } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';

export interface DisclosureGateConfig {
  /** A user rule file as parsed from YAML; may be invalid on purpose. */
  readonly rules?: unknown;
  /** Adapter rule fragments; may be invalid on purpose. */
  readonly fragments?: readonly unknown[];
}

export interface DisclosureGateHarness {
  /** A gate without any rule. */
  readonly empty: DisclosureGate;
  /**
   * A gate whose allow rules match `card` and `deniedCard` for every target, and whose deny
   * rule also matches `deniedCard` for every target.
   */
  readonly configured: DisclosureGate;
  /** A gate with the given configuration added to the `configured` rules. */
  withConfig(config: DisclosureGateConfig): DisclosureGate;
  /** The `configured` allow rules, to build variants from. */
  readonly allowRule: unknown;
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
const BOARD: TransferRequester = { kind: 'board' };
const FIVE_MINUTES = 5 * 60 * 1000;

const codeOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: unknown }).code ?? 'error';
  }
  return 'no error';
};

/** Bits carried by a base64url token. */
const tokenBits = (token: string) => token.replace(/=+$/, '').length * 6;

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
    const previewOf = (gate: DisclosureGate, cards: Card[], requester = BOARD) =>
      gate.preview({ connectorId: 'conformance', purpose: 'level1', request, cards, requester });
    const confirm = (gate: DisclosureGate, t: DisclosureTransfer) =>
      gate.confirm({
        transferId: t.transferId,
        payloadHash: t.payloadHash,
        sessionId: SESSION,
        currentEnvelope: t.preview,
      });
    const send = (
      gate: DisclosureGate,
      grant: DisclosureGrant,
      envelope: DisclosurePreviewEnvelope,
    ) => gate.redeem({ grant, envelope });
    const allDenied = (gate: DisclosureGate, cards: Card[]) =>
      cards.every((card) =>
        TARGETS.every((t) => gate.decide({ kind: 'card', card }, t).decision === 'deny'),
      );

    it.each(TARGETS)('denies %s by default (no rule)', (target) => {
      const { empty, card } = setup();
      const decision = empty.decide({ kind: 'card', card }, target);
      expect(decision.decision).toBe('deny');
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(decision.subject).toEqual({ kind: 'card', cardId: card.id });
      expect(decision.target).toBe(target);
    });

    it('denies a card that no rule matches, and lets deny rules win', () => {
      const { configured, otherCard, deniedCard } = setup();
      expect(allDenied(configured, [otherCard, deniedCard])).toBe(true);
    });

    it('allows a matching card for screen, local models and demos', () => {
      const { configured, card } = setup();
      for (const target of ['screen', 'local_model', 'demo'] as const) {
        expect(configured.decide({ kind: 'card', card }, target).decision).toBe('allow');
      }
    });

    it('never allows cloud_model in decide: cloud content needs a confirmed transfer', () => {
      const { configured, card } = setup();
      const decision = configured.decide({ kind: 'card', card }, 'cloud_model');
      expect(decision.decision).toBe('deny');
      expect(decision.confirmationRequired).toBe(true);
    });

    it('fails closed on invalid rules: unknown match key, unknown effect, broken file', () => {
      const { withConfig, card, deniedCard, otherCard, allowRule } = setup();
      const rule = allowRule as Record<string, unknown>;
      for (const rules of [
        { rules: [{ ...rule, match: { colour: ['red'] } }] },
        { rules: [{ ...rule, effect: 'maybe' }] },
        { rules: 'not a rule list' },
      ]) {
        const gate = withConfig({ rules });
        expect(allDenied(gate, [card, deniedCard, otherCard]), JSON.stringify(rules)).toBe(true);
        expect(gate.decide({ kind: 'card', card }, 'screen').reason).toMatch(/invalid/);
      }
    });

    it('rejects an adapter fragment that allows, and lets a deny fragment narrow', () => {
      const { withConfig, card, allowRule } = setup();
      const widening = {
        source: 'conformance-adapter',
        rules: [{ ...(allowRule as object), id: 'widen' }],
      };
      let gate: DisclosureGate | undefined;
      try {
        gate = withConfig({ fragments: [widening] });
      } catch {
        gate = undefined; // rejecting at load time is conformant too
      }
      if (gate) expect(allDenied(gate, [card])).toBe(true);
      const narrowed = withConfig({
        fragments: [
          {
            source: 'conformance-adapter',
            rules: [
              { id: 'narrow', effect: 'deny', targets: ['local_model'], match: { ids: [card.id] } },
            ],
          },
        ],
      });
      expect(narrowed.decide({ kind: 'card', card }, 'local_model').decision).toBe('deny');
      expect(narrowed.decide({ kind: 'card', card }, 'screen').decision).toBe('allow');
    });

    it('never discloses stance data beyond the screen, whatever the rules say', () => {
      const { configured, card } = setup();
      expect(configured.decide({ kind: 'stance', card }, 'screen').decision).toBe('allow');
      for (const target of ['local_model', 'cloud_model', 'demo'] as const) {
        expect(configured.decide({ kind: 'stance', card }, target).decision, target).toBe('deny');
      }
    });

    it('previews exactly the cleared cards, hashed with RFC 8785, for 5 minutes', () => {
      const { configured, card, deniedCard, otherCard } = setup();
      const transfer = previewOf(configured, [card, deniedCard, otherCard]);
      expect(transfer.cardIds).toEqual([card.id]);
      expect(transfer.preview.objects.map((c) => c.id)).toEqual([card.id]);
      expect(transfer.preview.target).toBe('cloud_model');
      expect(transfer.requestedBy).toBe('board');
      expect(transfer.payloadHash).toBe(computePayloadHash(transfer.preview));
      expect(Date.parse(transfer.expiresAt) - Date.parse(transfer.createdAt)).toBe(FIVE_MINUTES);
    });

    it('releases exactly the confirmed objects once, through a session-bound token', () => {
      const { configured, card } = setup();
      const t = previewOf(configured, [card]);
      const c = confirm(configured, t);
      expect(c.confirmedBy).toBe('human');
      expect(tokenBits(c.token ?? '')).toBeGreaterThanOrEqual(128);
      const grant = { kind: 'token' as const, token: c.token!, sessionId: SESSION };
      expect(codeOf(() => send(configured, { ...grant, sessionId: 'session-b' }, t.preview))).toBe(
        'binding',
      );
      const release = send(configured, grant, t.preview);
      expect(release.objects).toEqual(t.preview.objects);
      expect(release.confirmation.payloadHash).toBe(t.payloadHash);
      expect(release).not.toHaveProperty('token');
      // Replay after the send, by token and by any other route.
      expect(codeOf(() => send(configured, grant, t.preview))).toBe('replayed');
      expect(
        codeOf(() =>
          send(
            configured,
            { kind: 'connection', transferId: t.transferId, connectionId: 'x' },
            t.preview,
          ),
        ),
      ).not.toBe('no error');
      // decide still never allows cloud_model, also after a release.
      expect(configured.decide({ kind: 'card', card }, 'cloud_model').decision).toBe('deny');
    });

    it('releases a transfer an MCP connection asked for to that connection only, without a token', () => {
      const { configured, card } = setup();
      const t = previewOf(configured, [card], { kind: 'connection', connectionId: 'agent-1' });
      expect(t.requestedBy).toBe('mcp_connection');
      const c = confirm(configured, t);
      expect(c).not.toHaveProperty('token');
      const other = {
        kind: 'connection' as const,
        transferId: t.transferId,
        connectionId: 'agent-2',
      };
      expect(codeOf(() => send(configured, other, t.preview))).toBe('binding');
      const mine = { ...other, connectionId: 'agent-1' };
      expect(send(configured, mine, t.preview).objects.map((o) => o.id)).toEqual([card.id]);
      expect(codeOf(() => send(configured, mine, t.preview))).toBe('replayed');
    });

    it('refuses a send whose card was edited after confirmation (same id, new content)', () => {
      const { configured, card } = setup();
      const t = previewOf(configured, [card]);
      const c = confirm(configured, t);
      const editedCard = { ...card, title: `${card.title} (edited)` };
      const edited = {
        ...t.preview,
        objects: [{ ...editedCard, contentHash: computeContentHash(editedCard) }],
      };
      expect(
        codeOf(() =>
          send(configured, { kind: 'token', token: c.token!, sessionId: SESSION }, edited),
        ),
      ).toBe('mismatch');
      // The failed send consumed the confirmation.
      expect(
        codeOf(() =>
          send(configured, { kind: 'token', token: c.token!, sessionId: SESSION }, t.preview),
        ),
      ).toBe('replayed');
    });

    it('rejects a confirm whose previewed or current hash differs, and a second confirm', () => {
      const { configured, card } = setup();
      const t = previewOf(configured, [card]);
      const changed = { ...t.preview, connectorId: 'other-engine' };
      const base = { transferId: t.transferId, payloadHash: t.payloadHash, sessionId: SESSION };
      expect(codeOf(() => configured.confirm({ ...base, currentEnvelope: changed }))).toBe(
        'mismatch',
      );
      expect(
        codeOf(() =>
          configured.confirm({
            ...base,
            payloadHash: `sha256:${'0'.repeat(64)}`,
            currentEnvelope: t.preview,
          }),
        ),
      ).toBe('mismatch');
      expect(
        codeOf(() =>
          configured.confirm({
            ...base,
            transferId: '01M1HA4MC0T8585XX5H0E6NVRP',
            currentEnvelope: t.preview,
          }),
        ),
      ).toBe('unknown');
      confirm(configured, t);
      expect(codeOf(() => confirm(configured, t))).toBe('replayed');
    });

    it('lets nothing outlive 5 minutes: expired transfers, tokens and spent grants', () => {
      const { configured, card, advance } = setup();
      const t1 = previewOf(configured, [card]);
      advance(FIVE_MINUTES);
      expect(codeOf(() => confirm(configured, t1))).not.toBe('no error');
      const t2 = previewOf(configured, [card]);
      const c2 = confirm(configured, t2);
      advance(FIVE_MINUTES);
      expect(
        codeOf(() =>
          send(configured, { kind: 'token', token: c2.token!, sessionId: SESSION }, t2.preview),
        ),
      ).not.toBe('no error');
      const t3 = previewOf(configured, [card]);
      const c3 = confirm(configured, t3);
      send(configured, { kind: 'token', token: c3.token!, sessionId: SESSION }, t3.preview);
      advance(FIVE_MINUTES);
      expect(
        codeOf(() =>
          send(configured, { kind: 'token', token: c3.token!, sessionId: SESSION }, t3.preview),
        ),
      ).not.toBe('no error');
    });
  });
}
