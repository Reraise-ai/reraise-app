// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { ContextPackage, DisclosureRelease, ProposalCreate } from '../generated/contracts.js';

/** The answer of a model to a context package. World changes arrive only as proposals. */
export interface ModelAnswer {
  readonly text: string;
  readonly proposals: readonly ProposalCreate[];
}

/**
 * A replaceable model for level-2 support (ADR-0005, ADR-0015): a local or a cloud model
 * answering a question about a context package. Level-1 predictions use the separate
 * `Level1Engine` socket (ADR-0035). A model only ever receives gate-cleared input; a
 * `cloud_model` connector is called only with the `DisclosureRelease` of one confirmed transfer
 * and sends nothing but its objects (ADR-0031). It never writes: its suggestions come back as
 * proposals by `agent:<engine>`.
 */
export interface ModelConnector {
  /** Model name, used in the proposal author `agent:<engine>`. */
  readonly engine: string;
  /** Disclosure target class of this connector. */
  readonly target: 'local_model' | 'cloud_model';
  /** Level 2 support: answer a question about a context package. */
  ask(pkg: ContextPackage, question: string, release?: DisclosureRelease): Promise<ModelAnswer>;
}
