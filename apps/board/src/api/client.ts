// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Typed client of the Board API (schemas/openapi/board-api.yaml). One method per operationId;
// the types come from the generated contracts of @worldbuilder/core. The board is only a client
// of this API (AC-23): it never reads a store or a state directory.

import type {
  Card,
  CardPage,
  DecisionDraft,
  ContextPackage,
  ContextPackageRequest,
  DisclosureConfirmation,
  DisclosurePreviewRequest,
  DisclosureTransfer,
  Lage,
  LageCreateRequest,
  Level1PredictRequest,
  Level1Result,
  Level1State,
  Problem,
  Proposal,
  RuleDraft,
  RuleEvaluation,
  RulesEvaluateRequest,
  ProposalPage,
  Stance,
  StanceInput,
  StoredSourceProfile,
  UsageMetrics,
  WorldList,
} from '@worldbuilder/core';

export const SESSION_HEADER = 'X-Worldbuilder-Session';

/** An RFC 9457 problem answer (or a transport failure with status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;
  constructor(status: number, message: string, problem?: Problem) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface ClientOptions {
  /** Origin of the service, for example http://127.0.0.1:4310. Empty means same origin. */
  baseUrl: string;
  /** The human session token printed by `worldbuilder serve`. */
  token: string;
  fetch?: typeof fetch;
  /** Called once for every 401 answer: the session is gone, so the board signs out here. */
  onUnauthorized?: () => void;
}

export interface SearchParams {
  worldId?: string;
  text?: string;
  type?: string;
  layer?: string;
  limit?: number;
  cursor?: string;
}

export interface ProposalListParams {
  status?: 'pending' | 'accepted' | 'rejected';
  lageId?: string;
  limit?: number;
  cursor?: string;
  changedSince?: string;
}

export interface BoardClient {
  world_list(): Promise<WorldList>;
  lage_create(body: LageCreateRequest): Promise<Card>;
  decision_create(body: DecisionDraft): Promise<Card>;
  decision_save(cardId: string, card: Card): Promise<Card>;
  lage_get(lageId: string): Promise<Card>;
  lage_save(lageId: string, lage: Lage): Promise<Card>;
  cards_search(params?: SearchParams): Promise<CardPage>;
  card_get(cardId: string): Promise<Card>;
  stance_get(cardId: string): Promise<Stance>;
  stance_save(cardId: string, input: StanceInput): Promise<Stance>;
  context_package_get(body: ContextPackageRequest): Promise<ContextPackage>;
  proposal_list(params?: ProposalListParams): Promise<ProposalPage>;
  proposal_accept(proposalId: string, note?: string): Promise<Proposal>;
  proposal_reject(proposalId: string, note?: string): Promise<Proposal>;
  disclosure_transfer_preview(body: DisclosurePreviewRequest): Promise<DisclosureTransfer>;
  disclosure_confirm(transferId: string, payloadHash: string): Promise<DisclosureConfirmation>;
  /** Human-only (ADR-0035, ADR-0045): the engines and the latest estimate of a Lage. */
  level1_get(lageId: string, explain?: boolean): Promise<Level1State>;
  /** Human-only: estimate each player's next move; a cloud engine needs the transfer flow. */
  level1_predict(lageId: string, body: Level1PredictRequest): Promise<Level1Result>;
  /** Human-only: open a level-2 board analysis for one player of the latest estimate. */
  level1_escalate(lageId: string, playerCardId: string): Promise<Card>;
  /** Human-only (ADR-0041). Without `week` the rolling 7 days. */
  usage_metrics_get(week?: string): Promise<UsageMetrics>;
  /** Which of the user's rules fire on a Lage. No percentage (ADR-0013). */
  rules_evaluate(body: RulesEvaluateRequest): Promise<RuleEvaluation>;
  /** Human-only. Stores a rule card. The author is the human. */
  rule_create(body: RuleDraft): Promise<Card>;
  /** Human-only. Patches the title and the rule. A stale contentHash is a conflict. */
  rule_save(cardId: string, card: Card): Promise<Card>;
  /** Human-only. The derived profile of one source, kept on this device (ADR-0018). */
  source_profile_get(source: string): Promise<StoredSourceProfile>;
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function createClient(options: ClientOptions): BoardClient {
  const doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const base = options.baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      [SESSION_HEADER]: options.token,
      accept: 'application/json, application/problem+json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new ApiError(0, `cannot reach the service: ${(e as Error).message}`);
    }
    const text = await res.text();
    let json: unknown;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) {
      if (res.status === 401) options.onUnauthorized?.();
      const problem = isProblem(json) ? json : undefined;
      throw new ApiError(
        res.status,
        problem?.detail && problem.title
          ? `${problem.title}: ${problem.detail}`
          : (problem?.detail ?? problem?.title ?? `request failed with status ${res.status}`),
        problem,
      );
    }
    return json as T;
  }

  const enc = encodeURIComponent;
  return {
    world_list: () => call('GET', '/worlds'),
    lage_create: (body) => call('POST', '/lagen', body),
    decision_create: (body) => call('POST', '/decisions', body),
    decision_save: (id, card) => call('PUT', `/decisions/${enc(id)}`, card),
    lage_get: (id) => call('GET', `/lagen/${enc(id)}`),
    lage_save: (id, lage) => call('PUT', `/lagen/${enc(id)}`, lage),
    cards_search: (p = {}) => call('GET', `/cards${query({ ...p })}`),
    card_get: (id) => call('GET', `/cards/${enc(id)}`),
    stance_get: (id) => call('GET', `/cards/${enc(id)}/stance`),
    stance_save: (id, input) => call('PUT', `/cards/${enc(id)}/stance`, input),
    context_package_get: (body) => call('POST', '/context-packages', body),
    proposal_list: (p = {}) => call('GET', `/proposals${query({ ...p })}`),
    proposal_accept: (id, note) =>
      call('POST', `/proposals/${enc(id)}/accept`, note ? { note } : {}),
    proposal_reject: (id, note) =>
      call('POST', `/proposals/${enc(id)}/reject`, note ? { note } : {}),
    disclosure_transfer_preview: (body) => call('POST', '/disclosure/transfers', body),
    disclosure_confirm: (id, payloadHash) =>
      call('POST', `/disclosure/transfers/${enc(id)}/confirm`, { payloadHash }),
    level1_get: (id, explain) =>
      call('GET', `/lagen/${enc(id)}/level1${explain ? '?explain=true' : ''}`),
    level1_predict: (id, body) => call('POST', `/lagen/${enc(id)}/level1`, body),
    level1_escalate: (id, playerCardId) =>
      call('POST', `/lagen/${enc(id)}/level1/escalate`, { playerCardId }),
    usage_metrics_get: (week) => call('GET', `/metrics/usage${query({ week })}`),
    rules_evaluate: (body) => call('POST', '/rules/evaluate', body),
    rule_create: (body) => call('POST', '/rules', body),
    rule_save: (id, card) => call('PUT', `/rules/${enc(id)}`, card),
    source_profile_get: (source) => call('GET', `/source-profiles${query({ source })}`),
  };
}

function isProblem(v: unknown): v is Problem {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Problem).title === 'string' &&
    typeof (v as Problem).status === 'number'
  );
}
