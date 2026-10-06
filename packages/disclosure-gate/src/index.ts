// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Reference DisclosureGate (ADR-0012, ADR-0031): default deny, deny wins, per card and per
// target, with rules as data (`schemas/gate-rules.schema.json`). Adapter fragments may only
// deny. Cloud transfers are previewed, hashed (RFC 8785), confirmed by the human with the
// previewed hash, and released by a single-use token that the send consumes. All transfer
// state is in memory: a restart voids every transfer and token. Decisions are logged by the
// caller without card content.

import type {
  Card,
  DisclosureConfirmation,
  DisclosureConfirmationRef,
  DisclosureDecision,
  DisclosureGate,
  DisclosureItem,
  DisclosureTarget,
  DisclosureTransfer,
  GateRule,
  GateRuleFragment,
  GateRules,
  TransferErrorCode,
} from '@worldbuilder/core';
import { computePayloadHash, encodeUlid, parseUri } from '@worldbuilder/core';

export type { DisclosureTarget } from '@worldbuilder/core';

/** Transfer records and tokens live 5 minutes (ADR-0031). */
export const TRANSFER_TTL_MS = 5 * 60 * 1000;

export interface DisclosureGateOptions {
  /** The user's rules (validated against gate-rules.schema.json). */
  readonly rules?: GateRules;
  /** Adapter fragments; deny rules only (ADR-0031). */
  readonly fragments?: readonly GateRuleFragment[];
  /** Store instance ids whose configuration says `synthetic: true`. */
  readonly syntheticStores?: readonly string[];
  /** World names by id, for rules that name worlds. */
  readonly worldNames?: ReadonlyMap<string, string>;
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Random bytes for tokens; defaults to the platform's secure random source. */
  readonly randomBytes?: (n: number) => Uint8Array;
}

/** A rule of the effective set with where it comes from. */
export interface SourcedRule extends GateRule {
  readonly source: string;
}

class GateTransferError extends Error {
  constructor(
    readonly code: TransferErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const secureRandom = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The effective rule set: the user's rules plus all adapter fragments. A fragment containing
 * an allow rule is rejected, so an adapter can only narrow what leaves the device.
 */
export function effectiveRules(
  user: GateRules | undefined,
  fragments: readonly GateRuleFragment[] = [],
): SourcedRule[] {
  const out: SourcedRule[] = (user?.rules ?? []).map((r) => ({ ...r, source: 'user' }));
  for (const fragment of fragments) {
    const allow = fragment.rules.find((r) => r.effect !== 'deny');
    if (allow) {
      throw new Error(`adapter fragment ${fragment.source} may only deny; rule ${allow.id} allows`);
    }
    out.push(...fragment.rules.map((r) => ({ ...r, source: fragment.source })));
  }
  return out;
}

const anyOf = <T>(wanted: readonly T[] | undefined, actual: readonly T[]) =>
  wanted === undefined || wanted.some((w) => actual.includes(w));
const oneOf = <T>(wanted: readonly T[] | undefined, actual: T | undefined) =>
  wanted === undefined || (actual !== undefined && wanted.includes(actual));

export interface MatchContext {
  readonly syntheticStores?: readonly string[];
  readonly worldNames?: ReadonlyMap<string, string>;
}

/** True if every criterion of the rule holds for the card. */
export function ruleMatches(rule: GateRule, card: Card, ctx: MatchContext = {}): boolean {
  const m = rule.match;
  const worlds = (card.worlds ?? []).flatMap((id) => {
    const name = ctx.worldNames?.get(id);
    return name === undefined ? [id] : [id, name];
  });
  return (
    oneOf(m.visibility, card.visibility ?? 'private') &&
    oneOf(m.class, card.class) &&
    oneOf(m.collection, card.collection) &&
    oneOf(m.type, card.type) &&
    oneOf(m.ids, card.id) &&
    anyOf(m.worlds, worlds) &&
    anyOf(m.tags, card.tags ?? []) &&
    (m.syntheticStore === undefined ||
      (ctx.syntheticStores ?? []).includes(parseUri(card.uri).storeInstanceId))
  );
}

interface TokenRecord {
  readonly transferId: string;
  readonly sessionId: string;
  readonly expiresAt: number;
}

export function createDisclosureGate(options: DisclosureGateOptions = {}): DisclosureGate {
  const rules = effectiveRules(options.rules, options.fragments);
  const ctx: MatchContext = options;
  const now = options.now ?? (() => new Date());
  const random = options.randomBytes ?? secureRandom;
  const newId =
    options.newId ?? (() => encodeUlid(random(16).map((b, i) => (i === 0 ? b & 0x7f : b))));
  const transfers = new Map<string, DisclosureTransfer>();
  const confirmed = new Map<string, DisclosureConfirmationRef>();
  const tokens = new Map<string, TokenRecord>();
  const sent = new Map<string, DisclosureConfirmationRef>();
  const usedTokens = new Set<string>();

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
    const matching = rules.filter((r) => r.targets.includes(target) && ruleMatches(r, card, ctx));
    return matching.find((r) => r.effect === 'deny') ?? matching.find((r) => r.effect === 'allow');
  };

  const fail = (code: TransferErrorCode, message: string): never => {
    throw new GateTransferError(code, message);
  };

  return {
    decide(item, target, confirmation) {
      if (item.kind === 'stance' && target !== 'screen') {
        return result(item, target, 'deny', 'stance data never leaves the screen');
      }
      const rule = decidingRule(item.card, target);
      if (!rule) return result(item, target, 'deny', 'default deny: no allow rule matches');
      if (rule.effect === 'deny') {
        return result(item, target, 'deny', `deny rule ${rule.id} (${rule.source})`, {
          ruleId: rule.id,
        });
      }
      if (target !== 'cloud_model') {
        return result(item, target, 'allow', `allow rule ${rule.id}`, { ruleId: rule.id });
      }
      const released = confirmation && sent.get(confirmation.transferId);
      const ok =
        released !== undefined &&
        released.payloadHash === confirmation?.payloadHash &&
        released.confirmedAt === confirmation.confirmedAt &&
        released.cardIds.includes(item.card.id);
      if (!ok) {
        return result(item, target, 'deny', 'cloud transfer needs a confirmed, consumed token', {
          ruleId: rule.id,
          confirmationRequired: true,
        });
      }
      return result(item, target, 'allow', `allow rule ${rule.id} and confirmed transfer`, {
        ruleId: rule.id,
        confirmation: released,
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
        expiresAt: new Date(created.getTime() + TRANSFER_TTL_MS).toISOString(),
      };
      transfers.set(transfer.transferId, transfer);
      return transfer;
    },

    confirm({ transferId, payloadHash, sessionId, currentEnvelope }) {
      const transfer =
        transfers.get(transferId) ?? fail('unknown', `unknown transfer ${transferId}`);
      if (confirmed.has(transferId)) fail('replayed', 'this transfer is already confirmed');
      if (now().getTime() >= Date.parse(transfer.expiresAt))
        fail('expired', 'this transfer has expired');
      if (
        payloadHash !== transfer.payloadHash ||
        computePayloadHash(currentEnvelope) !== transfer.payloadHash
      ) {
        fail('mismatch', 'the payload differs from the preview');
      }
      const confirmedAt = now();
      const ref: DisclosureConfirmationRef = {
        transferId,
        payloadHash,
        cardIds: [...transfer.cardIds],
        confirmedAt: confirmedAt.toISOString(),
      };
      confirmed.set(transferId, ref);
      const token = base64url(random(32));
      const expiresAt = confirmedAt.getTime() + TRANSFER_TTL_MS;
      tokens.set(token, { transferId, sessionId, expiresAt });
      return {
        ...ref,
        token,
        tokenExpiresAt: new Date(expiresAt).toISOString(),
        confirmedBy: 'human',
      } satisfies DisclosureConfirmation;
    },

    redeem({ token, sessionId, envelope }) {
      const record = tokens.get(token);
      if (!record)
        return fail(usedTokens.has(token) ? 'replayed' : 'unknown', 'unknown or used token');
      if (record.sessionId !== sessionId) fail('session', 'token belongs to another session');
      // Consume before any further check or send: a second use fails, also under concurrency.
      tokens.delete(token);
      usedTokens.add(token);
      if (now().getTime() >= record.expiresAt) fail('expired', 'this token has expired');
      const ref = confirmed.get(record.transferId)!;
      if (computePayloadHash(envelope) !== ref.payloadHash) {
        fail('mismatch', 'the envelope differs from the confirmed one');
      }
      sent.set(record.transferId, ref);
      return ref;
    },
  };
}
