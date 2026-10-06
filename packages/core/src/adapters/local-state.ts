// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  AgentAuthor,
  CardId,
  DisclosureTarget,
  GateRule,
  GateRuleFragment,
  GateRules,
  Proposal,
  ProposalCreate,
  ProposalListRequest,
  ProposalPage,
  Stance,
  StanceInput,
} from '../generated/contracts.js';

/** Why a local-state call failed. */
export type LocalStateErrorCode =
  | 'invalid' // input or stored file does not validate against its schema
  | 'not_found'
  | 'conflict' // for example deciding a proposal that is already decided
  | 'unsafe_state_dir'; // state directory inside a store root or Git working tree (ADR-0030)

export interface LocalStateError extends Error {
  readonly code: LocalStateErrorCode;
}

/** One line of the gate decision log (ADR-0030): ids, targets and decisions, never content. */
export interface GateLogEntry {
  readonly cardId: CardId;
  /** `stance` when the decision was about the user's stance data on that card. */
  readonly item: 'card' | 'stance';
  readonly target: DisclosureTarget;
  readonly decision: 'allow' | 'deny';
  /** The deciding rule id or "default deny"; the gate never puts card text here. */
  readonly reason: string;
  /** ISO 8601 date-time; the store sets it when omitted. */
  readonly at?: string;
}

/** A rule of the effective set with where it comes from (`user` or an adapter id). */
export type SourcedGateRule = GateRule & { readonly source: string };

/**
 * Result of loading `<state>/gate-rules.yaml` plus adapter fragments (ADR-0031). It is always
 * safe to hand `rules` and `fragments` to the disclosure gate: when anything is invalid,
 * `ok` is false, `reason` says why, and `rules` is a deny-everything rule set.
 */
export interface GateRulesLoad {
  readonly ok: boolean;
  /** Set when `ok` is false: the error the board shows. */
  readonly reason?: string;
  /** True when the rule file does not exist (valid; default deny applies). */
  readonly missing?: boolean;
  readonly rules: GateRules;
  readonly fragments: readonly GateRuleFragment[];
  /** The effective rule set with the source of every rule, for display. */
  readonly effective: readonly SourcedGateRule[];
}

/**
 * Device-only state (ADR-0030): proposals, stances, the gate log and the gate rules, as files
 * in the per-user state directory. `core` defines the port and has no I/O; one writer, the
 * service process, uses it. Nothing here is ever sent to a model, exported or shared.
 */
export interface LocalStateStore {
  /** The resolved state directory. */
  readonly stateDir: string;

  /** Store a new pending proposal; the store sets id, status and createdAt. */
  createProposal(input: ProposalCreate, author: AgentAuthor): Promise<Proposal>;
  getProposal(id: string): Promise<Proposal | undefined>;
  /**
   * List proposals oldest change first. `cursor` and `changedSince` both mean "changed after
   * this cursor" (ADR-0032); `nextCursor` is always returned and never skips or repeats one.
   */
  listProposals(request?: ProposalListRequest): Promise<ProposalPage>;
  /** Human-only: accept or reject a pending proposal, recording decidedBy and decidedAt. */
  decideProposal(id: string, status: 'accepted' | 'rejected'): Promise<Proposal>;

  getStance(cardId: string): Promise<Stance | undefined>;
  listStances(): Promise<Stance[]>;
  /** Human-only: set the stance; the previous version is kept in `history`. */
  saveStance(cardId: string, input: StanceInput): Promise<Stance>;

  /** Append one decision to the gate log (rotating by size). */
  appendGateLog(entry: GateLogEntry): Promise<void>;
  /** Load the rules; invalid rules or fragments yield a deny-all result (fail closed). */
  loadGateRules(fragments?: readonly unknown[]): Promise<GateRulesLoad>;
}
