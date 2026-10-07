// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import type { Card, Proposal } from '@worldbuilder/core';

type Titles = ReadonlyMap<string, Card>;

const name = (titles: Titles, id: unknown): string =>
  typeof id === 'string'
    ? titles.get(id)?.title
      ? `"${titles.get(id)?.title}"`
      : `card ${id.slice(-6)}`
    : 'a card';

/** One line about what a proposal would do. Agent text is data: rendered as text, never HTML. */
export function summarizeProposal(p: Proposal, titles: Titles): string {
  const pl = p.payload as Record<string, unknown>;
  switch (p.kind) {
    case 'place_card':
      return `Place ${name(titles, pl['cardId'])} at (${pl['x']}, ${pl['y']})`;
    case 'move_card':
      return `Move ${name(titles, pl['cardId'])} to (${pl['x']}, ${pl['y']})`;
    case 'add_edge':
      return `Draw ${name(titles, pl['from'])} ${String(pl['kind'])} ${name(titles, pl['to'])}`;
    case 'create_card': {
      const card = pl['card'] as Partial<Card> | undefined;
      return `Create card "${card?.title ?? 'untitled'}"${card?.layer ? ` (${card.layer})` : ''}`;
    }
    case 'comment':
      return `Comment: ${String(pl['text'] ?? '')}`;
    case 'record_outcome':
      return `Record outcome of decision ${name(titles, pl['decisionId'])}: ${String(pl['outcome'] ?? '')}`;
  }
}
