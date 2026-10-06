// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Training export builder (ADR-0017, ADR-0028, ADR-0039): one JSONL decision trace per decision
// card that opted in and has a known outcome. Cards that did not opt in never appear, not even
// by id. Pure: the service decides the export through the disclosure gate under cloud_model
// semantics with a per-export confirmation before anything leaves the device.

import { SCHEMAS, computeContentHash, isKnownOutcome } from '@worldbuilder/core';
import type { Card, Proposal, TrainingExportRecord } from '@worldbuilder/core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { isTrainingEligible } from './index.js';

export interface TrainingTraceInput {
  /** The decision card (type decision, eleven sections). */
  readonly decision: Card;
  /** Cards that may be named: at least the decision's used cards. Others are ignored. */
  readonly cards: readonly Card[];
  /** The Lage the decision was taken on, if any. */
  readonly lage?: Card;
  /**
   * Proposals that shaped the decision. Only accepted moves are exported (`place_card`,
   * `move_card`, `add_edge`, and `create_card` whose card opted in), without `rationale`:
   * agent free text is never exported (comments and proposed outcomes are left out).
   */
  readonly brainstorm?: readonly Proposal[];
  readonly exportedAt: string;
}

export type TrainingSkipReason =
  'not_opted_in' | 'outcome_open' | 'no_used_cards' | 'decision_names_private_card';

export type TrainingTrace =
  | { readonly record: TrainingExportRecord; readonly skipped?: undefined }
  | { readonly record?: undefined; readonly skipped: TrainingSkipReason };

/** Same pattern as the `training-opt-in` cross-check of validate:schemas (ADR-0028). */
const ULID_IN_TEXT = /(?<![0-9A-Z])[0-7][0-9A-HJKMNP-TV-Z]{25}(?![0-9A-Z])/g;
const ULID_EXACT = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const PLAYER_FIELDS = [
  'interests',
  'capabilities',
  'dependencies',
  'moves',
  'redLines',
  'assumedGoals',
] as const;

/** Every ULID in `value`, also inside text, except under `worlds` (world ids are not cards). */
export function ulidsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') for (const m of value.matchAll(ULID_IN_TEXT)) out.push(m[0]);
  else if (Array.isArray(value)) value.forEach((v) => ulidsIn(v, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k !== 'worlds') ulidsIn(v, out);
  }
  return out;
}

const namesOnly = (value: unknown, allowed: ReadonlySet<string>) =>
  ulidsIn(value).every((id) => allowed.has(id));

type Mutable = Record<string, unknown>;

/** A used card with edges and player entries that name other cards reduced to `allowed`. */
function trimCard(card: Card, allowed: ReadonlySet<string>): Card | undefined {
  const c: Mutable = structuredClone(card) as unknown as Mutable;
  if (typeof c['source'] === 'string' && ULID_EXACT.test(c['source']) && !allowed.has(c['source']))
    return undefined;
  if (Array.isArray(c['edges'])) {
    c['edges'] = (c['edges'] as { target: string }[]).filter((e) => allowed.has(e.target));
  }
  for (const field of PLAYER_FIELDS) {
    if (!Array.isArray(c[field])) continue;
    const kept = (c[field] as { source: string }[]).filter(
      (e) => !ULID_EXACT.test(e.source) || allowed.has(e.source),
    );
    if (kept.length > 0) c[field] = kept;
    else delete c[field];
  }
  const pt = c['personalityType'] as { source?: string } | undefined;
  if (pt?.source !== undefined && ULID_EXACT.test(pt.source) && !allowed.has(pt.source)) {
    delete c['personalityType'];
  }
  if (!namesOnly(c, allowed)) return undefined;
  const trimmed = c as unknown as Card;
  return { ...trimmed, contentHash: computeContentHash(trimmed) };
}

/** A decision or Lage card is exported by its structure only (`TrainingStructuredCard`). */
function withoutBody(card: Card): Card {
  const c: Mutable = structuredClone(card) as unknown as Mutable;
  delete c['body'];
  return c as unknown as Card;
}

const MOVE_KINDS = new Set(['place_card', 'move_card', 'add_edge']);

/** An accepted move without agent free text; a created card only if it opted in itself. */
function exportableMove(p: Proposal): boolean {
  if (p.status !== 'accepted') return false;
  if (MOVE_KINDS.has(p.kind)) return true;
  if (p.kind === 'create_card') {
    return (p.payload as { card?: { training?: unknown } }).card?.training === true;
  }
  return false; // comment and record_outcome carry agent free text
}

/** The proposal without its `rationale` (agent free text, ADR-0039). */
function withoutAgentText(p: Proposal): Proposal {
  const copy = { ...p } as Record<string, unknown>;
  delete copy['rationale'];
  return copy as unknown as Proposal;
}

let validate: ((data: unknown) => boolean) | undefined;

/** Validate a record against `training-export-record.schema.json`. */
export function isValidTrainingRecord(record: unknown): boolean {
  if (!validate) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
    for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
    validate = ajv.getSchema(
      'https://worldbuilder.invalid/schemas/v0/training-export-record.schema.json',
    ) as (data: unknown) => boolean;
  }
  return validate(record);
}

/**
 * Build the trace of one decision, or say why it is skipped. Opt-in only: a card appears
 * only with `training: true`, and only if everything it names appears too.
 */
export function buildTrainingRecord(input: TrainingTraceInput): TrainingTrace {
  const { decision } = input;
  if (!isTrainingEligible(decision)) return { skipped: 'not_opted_in' };
  const sections = (decision as { sections?: { cardsUsed?: string[]; outcome?: string } }).sections;
  const outcome = sections?.outcome;
  if (typeof outcome !== 'string' || !isKnownOutcome(outcome)) {
    return { skipped: 'outcome_open' };
  }
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const lage = input.lage !== undefined && isTrainingEligible(input.lage) ? input.lage : undefined;
  const accepted = (input.brainstorm ?? []).filter(exportableMove).map(withoutAgentText);

  // Shrink the set of used cards until every exported card names only exported cards.
  let used = (sections?.cardsUsed ?? []).filter((id) => {
    const card = byId.get(id);
    return card !== undefined && isTrainingEligible(card);
  });
  let trimmed: Card[] = [];
  for (;;) {
    const allowed = new Set([decision.id, ...(lage ? [lage.id] : []), ...used]);
    trimmed = used.flatMap((id) => trimCard(byId.get(id)!, allowed) ?? []);
    if (trimmed.length === used.length) break;
    used = trimmed.map((c) => c.id);
  }
  if (used.length === 0) return { skipped: 'no_used_cards' };
  const allowed = new Set([decision.id, ...(lage ? [lage.id] : []), ...used]);

  const d = withoutBody(decision) as unknown as Mutable;
  d['sections'] = { ...(d['sections'] as Mutable), cardsUsed: used };
  if (Array.isArray(d['edges'])) {
    d['edges'] = (d['edges'] as { target: string }[]).filter((e) => allowed.has(e.target));
  }
  if (!namesOnly(d, allowed)) return { skipped: 'decision_names_private_card' };
  const exportedDecision = { ...(d as unknown as Card) };
  exportedDecision.contentHash = computeContentHash(exportedDecision);

  let exportedLage: Card | undefined;
  if (lage) {
    const l = withoutBody(lage) as unknown as Mutable;
    const state = l['lage'] as {
      cards: { id: string }[];
      edges: { from: string; to: string }[];
    };
    l['lage'] = {
      ...state,
      cards: state.cards.filter((p) => allowed.has(p.id)),
      edges: state.edges.filter((e) => allowed.has(e.from) && allowed.has(e.to)),
    };
    if (Array.isArray(l['edges'])) {
      l['edges'] = (l['edges'] as { target: string }[]).filter((e) => allowed.has(e.target));
    }
    if (namesOnly(l, allowed)) {
      exportedLage = l as unknown as Card;
      exportedLage.contentHash = computeContentHash(exportedLage);
    }
  }

  const record = {
    exportedAt: input.exportedAt,
    decision: exportedDecision,
    usedCards: trimmed,
    ...(exportedLage ? { lage: exportedLage } : {}),
    // A proposal may name itself and exported cards only.
    brainstorm: accepted.filter((p) => namesOnly(p, new Set([...allowed, p.id]))),
    outcome,
  } as unknown as TrainingExportRecord;
  if (!isValidTrainingRecord(record)) {
    throw new Error('training export built a record that does not satisfy its schema');
  }
  return { record };
}

/** One JSONL line per exported trace; skipped decisions produce no line. */
export function toJsonl(records: readonly TrainingExportRecord[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}
