// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// In-process notices for the live channel (ADR-0032). A notice names the kind and, when the
// change belongs to one Lage, that id. It never carries card text: the board reads the change
// back through the existing operations, which pass the disclosure gate.

export type LiveKind = 'proposal' | 'move';

export interface LiveNotice {
  readonly kind: LiveKind;
  readonly lageId?: string;
}

/** One process, many open boards. Listeners are called synchronously and must not throw. */
// shortcut: one process only, split the bus when a second service process must see the same moves
export class LiveBus {
  private readonly listeners = new Set<(notice: LiveNotice) => void>();

  publish(notice: LiveNotice): void {
    for (const listener of this.listeners) listener(notice);
  }

  subscribe(listener: (notice: LiveNotice) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** A proposal notice. `lageId` is taken from the payload when the proposal names a Lage. */
export function proposalNotice(payload: unknown): LiveNotice {
  const lageId =
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as { lageId?: unknown }).lageId === 'string'
      ? (payload as { lageId: string }).lageId
      : undefined;
  return lageId === undefined ? { kind: 'proposal' } : { kind: 'proposal', lageId };
}
