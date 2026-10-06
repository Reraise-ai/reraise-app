// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Conformance kit for DisclosureGate implementations (ADR-0008, ADR-0012, ADR-0031, ADR-0028,
// ADR-0036).

import type {
  Card,
  DisclosureGate,
  DisclosureGrant,
  DisclosurePreviewEnvelope,
  DisclosureTarget,
  DisclosureTransfer,
  TransferRequester,
} from '@worldbuilder/core';
import { buildUri, computeContentHash, computePayloadHash, parseUri } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { schemaValidator } from './validate.js';

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

const TARGETS: readonly DisclosureTarget[] = [
  'screen',
  'local_model',
  'cloud_model',
  'demo',
  'share',
];
const PUBLIC = 'https://example.org/conformance/public-report';
const ALLOW_ALL = { id: 'kit-allow-all', effect: 'allow', targets: [...TARGETS], match: {} };
const SHARED = 'https://worldbuilder.invalid/schemas/v0/shared-card.schema.json';

/** A card derived from `base` with another id and the given fields; `undefined` removes one. */
function variant(base: Card, id: string, patch: Record<string, unknown>): Card {
  const store = parseUri(base.uri).storeInstanceId;
  const merged: Record<string, unknown> = {
    id,
    externalId: id,
    uri: buildUri(store, id),
    format: 2,
    worlds: base.worlds,
    class: base.class,
    type: 'claim',
    title: `Conformance card ${id}`,
    layer: 'said',
    author: 'human',
    source: PUBLIC,
    release: 'community',
    ...patch,
  };
  for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
  return { ...merged, contentHash: computeContentHash(merged as never) } as unknown as Card;
}
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
      for (const target of ['local_model', 'cloud_model', 'demo', 'share'] as const) {
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

    describe('sharing with other people (ADR-0036)', () => {
      const cards = (base: Card) => ({
        external: variant(base, '01M1J0000000000000000000A1', {}),
        unreleased: variant(base, '01M1J0000000000000000000A2', { release: 'private' }),
        experience: variant(base, '01M1J0000000000000000000A3', {
          type: 'experience',
          layer: 'experience',
          source: undefined,
          release: 'private',
        }),
        releasedExperience: variant(base, '01M1J0000000000000000000A4', {
          type: 'experience',
          layer: 'experience',
          source: undefined,
        }),
        conclusions: {
          decision: variant(base, '01M1J0000000000000000000B1', {
            type: 'decision',
            layer: undefined,
          }),
          rule: variant(base, '01M1J0000000000000000000B2', { type: 'rule', layer: undefined }),
          rating: variant(base, '01M1J0000000000000000000B3', { type: 'rating' }),
          assumption: variant(base, '01M1J0000000000000000000B4', { type: 'assumption' }),
          agentAnalysis: variant(base, '01M1J0000000000000000000B5', { author: 'agent:analyst' }),
          ownClassification: variant(base, '01M1J0000000000000000000B6', { source: 'Own notes' }),
          citesOwnCard: variant(base, '01M1J0000000000000000000B7', {
            source: '01M1J0000000000000000000B3',
          }),
          unclassified: variant(base, '01M1J0000000000000000000B8', { layer: undefined }),
        },
      });
      const allowAll = (h: ReturnType<typeof setup>) =>
        h.withConfig({ rules: { rules: [ALLOW_ALL] } });

      it('never shares a conclusion, whatever the rules and the release say', () => {
        const h = setup();
        const gate = allowAll(h);
        const { conclusions } = cards(h.card);
        for (const [what, card] of Object.entries(conclusions)) {
          const d = gate.decide({ kind: 'card', card }, 'share');
          expect(d.decision, what).toBe('deny');
          expect(d.reason.length, what).toBeGreaterThan(0);
        }
        const bundle = gate.prepareShare(Object.values(conclusions));
        expect(bundle.objects).toEqual([]);
        expect(bundle.denied.map((d) => d.cardId)).toEqual(
          Object.values(conclusions).map((c) => c.id),
        );
      });

      it('shares own experience only after the user released that card', () => {
        const h = setup();
        const gate = allowAll(h);
        const { experience, releasedExperience } = cards(h.card);
        expect(gate.decide({ kind: 'card', card: experience }, 'share').decision).toBe('deny');
        expect(gate.decide({ kind: 'card', card: releasedExperience }, 'share').decision).toBe(
          'allow',
        );
      });

      it('shares an external-source card only when released and allowed by a rule', () => {
        const h = setup();
        const { external, unreleased } = cards(h.card);
        expect(h.empty.decide({ kind: 'card', card: external }, 'share').decision).toBe('deny');
        const gate = allowAll(h);
        expect(gate.decide({ kind: 'card', card: unreleased }, 'share').decision).toBe('deny');
        expect(gate.decide({ kind: 'card', card: external }, 'share').decision).toBe('allow');
        const narrowed = h.withConfig({
          rules: {
            rules: [
              ALLOW_ALL,
              {
                id: 'kit-no-share',
                effect: 'deny',
                targets: ['share'],
                match: { ids: [external.id] },
              },
            ],
          },
        });
        expect(narrowed.decide({ kind: 'card', card: external }, 'share').decision).toBe('deny');
      });

      it('shares content and provenance only, and player entries with a public source only', () => {
        const h = setup();
        const gate = allowAll(h);
        const { external, conclusions } = cards(h.card);
        const person = variant(h.card, '01M1J0000000000000000000C1', {
          collection: 'actors',
          type: 'person',
          tags: ['kit'],
          visibility: 'public',
          training: true,
          edges: [{ target: external.id, kind: 'supports', by: 'human' }],
          interests: [{ text: 'Public interest', source: PUBLIC }],
          assumedGoals: [{ text: 'Assumed by the user', source: conclusions.rating.id }],
          personalityType: { text: 'ISTJ', source: PUBLIC },
        });
        const bundle = gate.prepareShare([person, conclusions.decision]);
        expect(bundle.denied.map((d) => d.cardId)).toEqual([conclusions.decision.id]);
        expect(bundle.objects).toHaveLength(1);
        const shared = bundle.objects[0]!;
        const validate = schemaValidator(SHARED);
        expect(validate(shared), JSON.stringify(validate.errors)).toBe(true);
        expect(shared.id).toBe(person.id);
        expect(shared.source).toBe(person.source);
        expect(shared.interests).toEqual(person.interests);
        for (const k of [
          'uri',
          'externalId',
          'worlds',
          'tags',
          'class',
          'visibility',
          'release',
          'training',
          'edges',
          'assumedGoals',
          'personalityType',
        ]) {
          expect(shared, k).not.toHaveProperty(k);
        }
      });

      it('lets decision and rule cards go to a cloud model only through a confirmed transfer', () => {
        const h = setup();
        const gate = allowAll(h);
        const { decision, rule } = cards(h.card).conclusions;
        for (const card of [decision, rule]) {
          const d = gate.decide({ kind: 'card', card }, 'cloud_model');
          expect(d.decision).toBe('deny');
          expect(d.confirmationRequired).toBe(true);
          expect(gate.decide({ kind: 'card', card }, 'share').decision).toBe('deny');
        }
        const t = previewOf(gate, [decision, rule]);
        expect(t.cardIds).toEqual([decision.id, rule.id]);
        const c = confirm(gate, t);
        const release = send(
          gate,
          { kind: 'token', token: c.token!, sessionId: SESSION },
          t.preview,
        );
        expect(release.objects.map((o) => o.id)).toEqual([decision.id, rule.id]);
      });
    });
  });
}
