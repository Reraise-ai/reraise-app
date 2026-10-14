// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The live what-if layer (ADR-0050). One list of assumptions per Lage, in this process only.
// A restart drops it. The ids are ULIDs and are not card ids.
// shortcut: scenario assumptions are not added to the level-1 request yet, upgrade when that request must name them (ADR-0035).

import type { ScenarioAssumption } from '@worldbuilder/core';
import { createUlidFactory } from '@worldbuilder/local-state';

/** At most one layer per Lage the user has edited in this process. */
export class ScenarioLayers {
  private readonly layers = new Map<string, ScenarioAssumption[]>();
  private readonly newId: () => string;

  constructor(now: () => Date) {
    this.newId = createUlidFactory({ now: () => now().getTime() });
  }

  get(lageId: string): ScenarioAssumption[] {
    return this.layers.get(lageId) ?? [];
  }

  /** Trim, drop blanks and repeats, assign a new id to each statement that remains. */
  replace(lageId: string, statements: readonly string[]): ScenarioAssumption[] {
    const seen = new Set<string>();
    const next: ScenarioAssumption[] = [];
    for (const raw of statements) {
      const statement = raw.trim();
      if (statement === '' || seen.has(statement)) continue;
      seen.add(statement);
      next.push({ id: this.newId(), statement });
    }
    if (next.length === 0) this.layers.delete(lageId);
    else this.layers.set(lageId, next);
    return next;
  }
}
