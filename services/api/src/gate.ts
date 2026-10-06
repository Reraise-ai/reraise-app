// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The disclosure gate as the service uses it (ADR-0012, ADR-0031): the reference gate built
// from the rules in the state directory, rebuilt when the rule file changes, with every decision
// written to the gate log by fixed reason code (never prose, never card content).

import type {
  Card,
  DisclosureDecision,
  DisclosureGate,
  DisclosureTarget,
  GateLogReason,
  LocalStateStore,
  StorageAdapter,
} from '@worldbuilder/core';
import { createDisclosureGate } from '@worldbuilder/disclosure-gate';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from './util.js';

export interface GateServiceOptions {
  readonly storage: StorageAdapter;
  readonly localState: LocalStateStore;
  /** Store instance ids whose configuration says `synthetic: true` (demo clearance). */
  readonly syntheticStores?: readonly string[];
  readonly now?: () => Date;
}

/** Map a gate decision to one of the fixed log reasons (ADR-0030). */
export function reasonCodeOf(d: DisclosureDecision, rulesInvalid = false): GateLogReason {
  if (rulesInvalid || d.reason.startsWith('gate rules invalid')) return 'invalid_rules';
  if (d.subject.kind === 'stance' && d.decision === 'deny') return 'stance_screen_only';
  if (d.confirmationRequired === true) return 'confirmation_required';
  if (d.ruleId !== undefined) return d.decision === 'allow' ? 'rule_allow' : 'rule_deny';
  return 'default_deny';
}

/** Text a caller may see for a decision: fixed wording plus a rule id, never rule-file text. */
export function publicReason(d: DisclosureDecision, rulesInvalid = false): string {
  switch (reasonCodeOf(d, rulesInvalid)) {
    case 'invalid_rules':
      return 'the gate rules are invalid, everything is denied';
    case 'stance_screen_only':
      return 'stance data never leaves the screen';
    case 'confirmation_required':
      return 'cloud content needs a confirmed transfer';
    case 'rule_allow':
      return `allow rule ${d.ruleId}`;
    case 'rule_deny':
      return `deny rule ${d.ruleId}`;
    default:
      return 'default deny: no allow rule matches';
  }
}

export class GateService {
  private gate: DisclosureGate | undefined;
  private signature = '';
  private readonly lock = new Mutex();
  private readonly rulesFile: string;
  private readonly listeners: (() => void)[] = [];
  /** Why the rules are not in force, shown to the user; undefined when they load. */
  rulesError: string | undefined;

  constructor(private readonly options: GateServiceOptions) {
    this.rulesFile = path.join(options.localState.stateDir, 'gate-rules.yaml');
  }

  /** Called whenever the gate is rebuilt: pending transfers of the old gate are void. */
  onRebuild(listener: () => void): void {
    this.listeners.push(listener);
  }

  private async currentSignature(): Promise<string> {
    try {
      const info = await stat(this.rulesFile);
      return `${info.mtimeMs}:${info.size}:${info.ino}`;
    } catch {
      return 'missing';
    }
  }

  /** The gate for the rules in force now; rebuilt (voiding open transfers) on a rule change. */
  async current(): Promise<DisclosureGate> {
    const signature = await this.currentSignature();
    if (this.gate && signature === this.signature) return this.gate;
    return this.lock.run(async () => {
      const again = await this.currentSignature();
      if (this.gate && again === this.signature) return this.gate;
      const load = await this.options.localState.loadGateRules();
      this.rulesError = load.ok ? undefined : load.reason;
      const worldNames = new Map(
        (await this.options.storage.listWorlds()).map((w) => [w.id, w.name] as const),
      );
      const wasBuilt = this.gate !== undefined;
      this.gate = createDisclosureGate({
        rules: load.rules,
        fragments: load.fragments,
        worldNames,
        ...(this.options.syntheticStores ? { syntheticStores: this.options.syntheticStores } : {}),
        ...(this.options.now ? { now: this.options.now } : {}),
      });
      this.signature = again;
      if (wasBuilt) for (const listener of this.listeners) listener();
      return this.gate;
    });
  }

  private async log(
    cardId: string,
    item: 'card' | 'stance',
    target: DisclosureTarget,
    d: DisclosureDecision,
  ): Promise<void> {
    await this.options.localState.appendGateLog({
      cardId,
      item,
      target,
      decision: d.decision,
      reason: reasonCodeOf(d, this.rulesError !== undefined),
      ...(d.ruleId !== undefined ? { ruleId: d.ruleId } : {}),
    });
  }

  /** Decide one card for a target and log it. A log failure fails the request (no silent egress). */
  async decide(
    card: Card,
    target: DisclosureTarget,
    kind: 'card' | 'stance' = 'card',
  ): Promise<DisclosureDecision> {
    const gate = await this.current();
    const decision = gate.decide({ kind, card }, target);
    await this.log(card.id, kind, target, decision);
    return decision;
  }

  /** Split cards into those the gate allows for the target and the denied ids with reasons. */
  async filter(
    cards: readonly Card[],
    target: DisclosureTarget,
  ): Promise<{
    allowed: Card[];
    denied: { cardId: string; reason: string }[];
  }> {
    const allowed: Card[] = [];
    const denied: { cardId: string; reason: string }[] = [];
    for (const card of cards) {
      const d = await this.decide(card, target);
      if (d.decision === 'allow') allowed.push(card);
      else denied.push({ cardId: card.id, reason: publicReason(d, this.rulesError !== undefined) });
    }
    return { allowed, denied };
  }

  /** Log the release of a card inside a confirmed cloud transfer. */
  async logConfirmedRelease(cardIds: readonly string[]): Promise<void> {
    for (const cardId of cardIds) {
      await this.options.localState.appendGateLog({
        cardId,
        item: 'card',
        target: 'cloud_model',
        decision: 'allow',
        reason: 'confirmed_transfer',
      });
    }
  }
}
