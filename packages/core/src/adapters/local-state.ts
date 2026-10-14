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
  ScenarioAttachment,
  SourceProfile,
  Stance,
  StanceInput,
  StoredSourceProfile,
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

/**
 * Fixed reason codes of the gate log. The caller (the service, around `DisclosureGate.decide`)
 * must map each decision to one of these and pass the deciding rule's id as `ruleId`; it must
 * never put free text, card titles or card bodies into a log entry.
 */
export const GATE_LOG_REASONS = [
  'default_deny',
  'rule_allow',
  'rule_deny',
  'stance_screen_only',
  'invalid_rules',
  'confirmation_required',
  'confirmed_transfer',
  'connection_not_registered',
  /** `share` or a demo of a real store: conclusions are private (ADR-0036). */
  'conclusion_private',
  /** `share`: the user has not released the card (ADR-0036). */
  'not_released',
] as const;
export type GateLogReason = (typeof GATE_LOG_REASONS)[number];

/** One line of the gate decision log (ADR-0030): ids, targets and decisions, never content. */
export interface GateLogEntry {
  readonly cardId: CardId;
  /** `stance` when the decision was about the user's stance data on that card. */
  readonly item: 'card' | 'stance';
  readonly target: DisclosureTarget;
  readonly decision: 'allow' | 'deny';
  /** Why, as a fixed code: never prose, never card text. */
  readonly reason: GateLogReason;
  /** The deciding rule, when a rule decided. */
  readonly ruleId?: string;
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
 * Device-only state (ADR-0030): proposals, stances, source profiles, the gate log and the gate
 * rules, as files in the per-user state directory. `core` defines the port and has no I/O; one
 * writer, the service process, uses it. Nothing here is ever sent to a model, exported or shared.
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
  /** Valid stances; a damaged file is skipped (see `damagedFiles`). */
  listStances(): Promise<Stance[]>;
  /** Human-only: set the stance; the previous version is kept in `history`. */
  saveStance(cardId: string, input: StanceInput): Promise<Stance>;

  /** The stored profile of one source, or `undefined` when none has been derived yet. */
  getSourceProfile(source: string): Promise<StoredSourceProfile | undefined>;
  /**
   * Replace the stored profile. The previous profile is appended to `earlier`. Saving the
   * same profile again changes nothing. Human-only; the service derives it, nobody edits it.
   */
  saveSourceProfile(profile: SourceProfile): Promise<StoredSourceProfile>;

  /** The what-if snapshot attached to a decision, or `undefined` when none is (ADR-0050). */
  getScenarioAttachment(decisionId: string): Promise<ScenarioAttachment | undefined>;
  /**
   * Replace the snapshot. Saving the same one again changes nothing. Human-only. Not a card.
   */
  saveScenarioAttachment(attachment: ScenarioAttachment): Promise<ScenarioAttachment>;

  /**
   * Names of proposal and stance files that were skipped or refused because they are damaged
   * (not JSON, schema-invalid, or whose inner id differs from the file name). Such a proposal
   * counts nowhere (ADR-0011); the board should surface the list.
   */
  damagedFiles(): Promise<{ readonly proposals: string[]; readonly stances: string[] }>;
  /** Append one decision to the gate log (rotating by size). */
  appendGateLog(entry: GateLogEntry): Promise<void>;
  /** Load the rules; invalid rules or fragments yield a deny-all result (fail closed). */
  loadGateRules(fragments?: readonly unknown[]): Promise<GateRulesLoad>;
}
