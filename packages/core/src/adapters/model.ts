// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  ContextPackage,
  DisclosureConfirmationRef,
  Level1Answer,
  Level1Request,
  ProposalCreate,
} from '../generated/contracts.js';

/** The answer of a model to a context package. World changes arrive only as proposals. */
export interface ModelAnswer {
  readonly text: string;
  readonly proposals: readonly ProposalCreate[];
}

/**
 * A replaceable model or engine (ADR-0005, ADR-0015): the local rules engine, a local model,
 * a cloud model, or the Jev connector. It only ever receives gate-cleared input; a
 * `cloud_model` connector is called only after the service consumed the confirmation token
 * of this exact transfer, and receives the reference of that confirmation (ADR-0031). It
 * never writes: its suggestions come back as proposals by `agent:<engine>`.
 */
export interface ModelConnector {
  /** Engine name, as in `Level1Answer.engine` and the proposal author `agent:<engine>`. */
  readonly engine: string;
  /** Disclosure target class of this connector. */
  readonly target: 'local_model' | 'cloud_model';
  /** Level 1: a typed, schema-bound quick answer. An attributed estimate, never a verdict. */
  decide(request: Level1Request, confirmation?: DisclosureConfirmationRef): Promise<Level1Answer>;
  /** Level 2 support: answer a question about a context package. */
  ask(
    pkg: ContextPackage,
    question: string,
    confirmation?: DisclosureConfirmationRef,
  ): Promise<ModelAnswer>;
}
