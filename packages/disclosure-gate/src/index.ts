// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Reference DisclosureGate (ADR-0012, ADR-0031, ADR-0028): default deny, deny wins, per card
// and per target, with rules as data validated against `schemas/gate-rules.schema.json`.
// Invalid rules or an allowing adapter fragment fail closed: every decision is deny.
//
// Sharing with other people (target `share`, ADR-0036) never allows a conclusion, needs the
// user's release of the card and an allow rule, and carries the share projection only.
//
// Cloud content never passes `decide`: it leaves only as the objects `redeem` returns for one
// previewed, human-confirmed, unexpired and unused transfer, bound to the board session (by a
// single-use token) or to the MCP connection that asked. All transfer state is in memory and
// pruned on expiry; a restart voids it. Decisions are logged by the caller without content.

import type {
  Card,
  DisclosureConfirmation,
  DisclosureConfirmationRef,
  DisclosureDecision,
  DisclosureGate,
  DisclosureItem,
  DisclosurePreviewEnvelope,
  DisclosureTarget,
  DisclosureTransfer,
  GateRule,
  GateRuleFragment,
  GateRules,
  TransferErrorCode,
  TransferRequester,
} from '@worldbuilder/core';
import {
  SCHEMAS,
  computePayloadHash,
  encodeUlid,
  originOf,
  parseUri,
  shareProjection,
} from '@worldbuilder/core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

export type { DisclosureTarget } from '@worldbuilder/core';

/** Transfer records and tokens live 5 minutes (ADR-0031). */
export const TRANSFER_TTL_MS = 5 * 60 * 1000;
const RULES_ID = 'https://worldbuilder.invalid/schemas/v0/gate-rules.schema.json';

export interface DisclosureGateOptions {
  /** The user's rule file, as parsed; validated here. */
  readonly rules?: unknown;
  /** Adapter fragments, as supplied; validated here and deny-only (ADR-0031). */
  readonly fragments?: readonly unknown[];
  /** Store instance ids whose configuration says `synthetic: true`. */
  readonly syntheticStores?: readonly string[];
  /** World names by id, for rules that name worlds. */
  readonly worldNames?: ReadonlyMap<string, string>;
  readonly now?: () => Date;
  /** Random bytes for ids and tokens; defaults to the platform's secure random source. */
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

let validators:
  | {
      rules: (data: unknown) => boolean;
      fragment: (data: unknown) => boolean;
      errors: () => string;
    }
  | undefined;

/** Ajv validators for the rule file and fragments, compiled once from the contract schemas. */
function ruleValidators() {
  if (!validators) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    // ajv-formats is CommonJS; under NodeNext its default import is the module object.
    (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
    for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
    const rules = ajv.getSchema(RULES_ID)!;
    const fragment = ajv.getSchema(`${RULES_ID}#/$defs/fragment`)!;
    let last: typeof rules.errors = null;
    validators = {
      rules: (d) => {
        const ok = rules(d) as boolean;
        last = rules.errors;
        return ok;
      },
      fragment: (d) => {
        const ok = fragment(d) as boolean;
        last = fragment.errors;
        return ok;
      },
      errors: () => (last ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; '),
    };
  }
  return validators;
}

/**
 * The effective rule set: the user's rules plus all adapter fragments, each validated against
 * the rule schema. Throws on an invalid rule file or fragment, including a fragment with an
 * allow rule, so an adapter can only narrow what leaves the device.
 */
export function effectiveRules(user: unknown, fragments: readonly unknown[] = []): SourcedRule[] {
  const v = ruleValidators();
  if (user !== undefined && !v.rules(user)) throw new Error(`invalid gate rules: ${v.errors()}`);
  const out: SourcedRule[] = ((user as GateRules | undefined)?.rules ?? []).map((r) => ({
    ...r,
    source: 'user',
  }));
  for (const f of fragments) {
    if (!v.fragment(f)) {
      const source = (f as { source?: unknown } | null)?.source;
      throw new Error(
        `invalid gate rule fragment ${String(source)} (deny rules only): ${v.errors()}`,
      );
    }
    const fragment = f as GateRuleFragment;
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

interface TransferRecord {
  readonly transfer: DisclosureTransfer;
  readonly requester: TransferRequester;
  confirmed?: DisclosureConfirmationRef;
  /** The board token, or `connection:<id>` for a connection-bound transfer. */
  grantKey?: string;
  grantSession?: string;
  grantExpiresAt?: number;
  used?: boolean;
}

export function createDisclosureGate(options: DisclosureGateOptions = {}): DisclosureGate {
  let rules: SourcedRule[] = [];
  let configError: string | undefined;
  try {
    rules = effectiveRules(options.rules, options.fragments);
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }
  const ctx: MatchContext = options;
  const now = options.now ?? (() => new Date());
  const random = options.randomBytes ?? secureRandom;
  // 128 random bits always encode below 2^128, the ULID range.
  const newId = () => encodeUlid(random(16));
  const transfers = new Map<string, TransferRecord>();
  const tokens = new Map<string, string>(); // token -> transferId

  /** Forget expired transfers and their grants: nothing outlives 5 minutes. */
  const prune = () => {
    const t = now().getTime();
    for (const [id, rec] of transfers) {
      const ends = Math.max(Date.parse(rec.transfer.expiresAt), rec.grantExpiresAt ?? 0);
      if (t >= ends) {
        transfers.delete(id);
        if (rec.grantKey) tokens.delete(rec.grantKey);
      }
    }
  };

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

  const isSyntheticCard = (card: Card) =>
    (ctx.syntheticStores ?? []).includes(parseUri(card.uri).storeInstanceId);

  /** The rule that decides: a matching deny rule wins, else a matching allow rule. */
  const decidingRule = (card: Card, target: DisclosureTarget) => {
    const matching = rules.filter((r) => r.targets.includes(target) && ruleMatches(r, card, ctx));
    return matching.find((r) => r.effect === 'deny') ?? matching.find((r) => r.effect === 'allow');
  };

  const fail = (code: TransferErrorCode, message: string): never => {
    throw new GateTransferError(code, message);
  };

  const sameEnvelope = (confirmed: DisclosurePreviewEnvelope, current: DisclosurePreviewEnvelope) =>
    computePayloadHash(current) === computePayloadHash(confirmed) &&
    current.objects.length === confirmed.objects.length &&
    current.objects.every(
      (o, i) =>
        o.id === confirmed.objects[i]!.id && o.contentHash === confirmed.objects[i]!.contentHash,
    );

  return {
    decide(item, target) {
      if (configError)
        return result(
          item,
          target,
          'deny',
          `gate rules invalid, everything is denied: ${configError}`,
        );
      if (item.kind === 'stance' && target !== 'screen') {
        return result(item, target, 'deny', 'stance data never leaves the screen');
      }
      if (target === 'share') {
        // Conclusions are private (ADR-0036): no rule and no release can widen this.
        const origin = originOf(item.card);
        if (origin.originClass === 'conclusion') {
          return result(item, target, 'deny', `conclusions are never shared: ${origin.reason}`);
        }
        if ((item.card.release ?? 'private') === 'private') {
          return result(item, target, 'deny', 'not released for sharing by the user');
        }
      }
      if (target === 'demo' && !isSyntheticCard(item.card)) {
        // Until the owner rules on demos (OD-8), an audience counts as other people for
        // conclusions and the personality type; synthetic stores stay demo material.
        const origin = originOf(item.card);
        if (origin.originClass === 'conclusion') {
          return result(
            item,
            target,
            'deny',
            `conclusions are never shown in demos: ${origin.reason}`,
          );
        }
        if (item.card.personalityType !== undefined) {
          return result(item, target, 'deny', 'a personality type is never shown in demos');
        }
      }
      const rule = decidingRule(item.card, target);
      if (!rule) return result(item, target, 'deny', 'default deny: no allow rule matches');
      if (rule.effect === 'deny') {
        return result(item, target, 'deny', `deny rule ${rule.id} (${rule.source})`, {
          ruleId: rule.id,
        });
      }
      if (target === 'cloud_model') {
        return result(
          item,
          target,
          'deny',
          'cloud content leaves only through a confirmed transfer',
          {
            ruleId: rule.id,
            confirmationRequired: true,
          },
        );
      }
      return result(item, target, 'allow', `allow rule ${rule.id}`, { ruleId: rule.id });
    },

    preview(input) {
      prune();
      if (configError) throw new Error(`gate rules invalid: ${configError}`);
      const objects = input.cards.filter((c) => decidingRule(c, 'cloud_model')?.effect === 'allow');
      if (objects.length === 0)
        throw new Error('no card of this transfer is cleared for cloud_model');
      const preview = {
        target: 'cloud_model' as const,
        connectorId: input.connectorId,
        request: input.request,
        objects: structuredClone(objects),
      };
      const created = now();
      const transfer: DisclosureTransfer = {
        transferId: newId(),
        purpose: input.purpose,
        requestedBy: input.requester.kind === 'board' ? 'board' : 'mcp_connection',
        cardIds: objects.map((c) => c.id),
        payloadHash: computePayloadHash(preview),
        preview,
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + TRANSFER_TTL_MS).toISOString(),
      };
      transfers.set(transfer.transferId, { transfer, requester: input.requester });
      return structuredClone(transfer);
    },

    confirm({ transferId, payloadHash, sessionId, currentEnvelope }) {
      prune();
      const rec =
        transfers.get(transferId) ?? fail('unknown', `unknown or expired transfer ${transferId}`);
      if (rec.confirmed) fail('replayed', 'this transfer is already confirmed');
      if (now().getTime() >= Date.parse(rec.transfer.expiresAt))
        fail('expired', 'this transfer has expired');
      if (
        payloadHash !== rec.transfer.payloadHash ||
        !sameEnvelope(rec.transfer.preview, currentEnvelope)
      ) {
        fail('mismatch', 'the payload differs from the preview');
      }
      const confirmedAt = now();
      const ref: DisclosureConfirmationRef = {
        transferId,
        payloadHash,
        cardIds: [...rec.transfer.cardIds],
        confirmedAt: confirmedAt.toISOString(),
      };
      rec.confirmed = ref;
      rec.grantExpiresAt = confirmedAt.getTime() + TRANSFER_TTL_MS;
      if (rec.requester.kind === 'connection') {
        rec.grantKey = `connection:${rec.requester.connectionId}`;
        return { ...ref, confirmedBy: 'human' } satisfies DisclosureConfirmation;
      }
      const token = base64url(random(32));
      rec.grantKey = token;
      rec.grantSession = sessionId;
      tokens.set(token, transferId);
      return {
        ...ref,
        token,
        tokenExpiresAt: new Date(rec.grantExpiresAt).toISOString(),
        confirmedBy: 'human',
      } satisfies DisclosureConfirmation;
    },

    prepareShare(cards) {
      const objects = [];
      const denied = [];
      for (const card of cards) {
        const d = this.decide({ kind: 'card', card }, 'share');
        if (d.decision === 'allow') objects.push(shareProjection(card));
        else denied.push({ cardId: card.id, reason: d.reason });
      }
      return { objects, denied };
    },

    redeem({ grant, envelope }) {
      prune();
      const transferId = grant.kind === 'token' ? tokens.get(grant.token) : grant.transferId;
      const rec = transferId === undefined ? undefined : transfers.get(transferId);
      if (!rec?.confirmed) return fail('unknown', 'unknown, unconfirmed or expired grant');
      if (grant.kind === 'token') {
        if (rec.grantKey !== grant.token || rec.grantSession !== grant.sessionId) {
          fail('binding', 'the token belongs to another session');
        }
      } else if (rec.grantKey !== `connection:${grant.connectionId}`) {
        fail('binding', 'the transfer was confirmed for another connection');
      }
      if (rec.used) fail('replayed', 'this transfer was already sent');
      // Consume before any further check or send: a second use fails, also under concurrency.
      rec.used = true;
      if (now().getTime() >= rec.grantExpiresAt!) fail('expired', 'the confirmation has expired');
      if (!sameEnvelope(rec.transfer.preview, envelope)) {
        fail('mismatch', 'the envelope differs from the confirmed one');
      }
      return {
        confirmation: rec.confirmed,
        objects: structuredClone(rec.transfer.preview.objects),
      };
    },
  };
}
