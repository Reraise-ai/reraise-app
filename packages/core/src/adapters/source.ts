// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { CardDraft, Finding } from '../generated/contracts.js';

export interface FindingsQuery {
  /** Only findings retrieved after this time (ISO date-time). */
  readonly since?: string;
  readonly text?: string;
  readonly limit?: number;
}

/**
 * Reports new findings from an external source (a vault, a news service, a legal database)
 * with their provenance (ADR-0014). Read only: a connector never writes to a world. Pinning is
 * a human action (or an agent proposal) that turns a finding into a reference card through
 * the StorageAdapter: reference first, pin on demand.
 */
export interface SourceConnector {
  /** Connector id, as in `Finding.connector`. */
  readonly id: string;
  /** New findings; every finding carries a URI and provenance. */
  findings(query?: FindingsQuery): Promise<readonly Finding[]>;
  /**
   * The reference card a pin would create: URI as source, minimal display text, the
   * finding's provenance. Pure; it writes nothing.
   */
  referenceCard(finding: Finding): CardDraft;
}
