// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Human-only findings list and pin (ADR-0014). The list is references. Pin reads the
// finding again from the source and stores a private card. The note text is never read.

import {
  selectFindings,
  type Card,
  type Finding,
  type FindingPinRequest,
  type FindingsQuery,
  type Lage,
} from '@worldbuilder/core';
import { validators } from './contract.js';
import { readLage, withPlacement, writeLageVersion } from './lage.js';
import type { Handler } from './operations.js';
import { HttpError } from './problem.js';
import type { Services } from './services.js';

const str = (v: unknown): string => v as string;
const checkDraft = validators.strict('card.schema.json#/$defs/draft');

const GRID_X = 280;
const GRID_Y = 170;
const COLUMNS = 4;

/** Same grid as the board, so a pin does not land on a card the user already placed. */
function freeSpot(lage: Lage): { x: number; y: number } {
  const taken = new Set(
    lage.cards.map((c) => `${Math.round(c.x / GRID_X)},${Math.round(c.y / GRID_Y)}`),
  );
  for (let i = 0; i < 10_000; i++) {
    const key = `${i % COLUMNS},${Math.floor(i / COLUMNS)}`;
    if (!taken.has(key)) return { x: (i % COLUMNS) * GRID_X, y: Math.floor(i / COLUMNS) * GRID_Y };
  }
  return { x: 0, y: 0 };
}

function cites(card: Card, uri: string): boolean {
  return card.source === uri || (card.refs ?? []).some((ref) => ref.url === uri);
}

/** shortcut: walks the world 100 cards at a time, up to 50 pages, until search indexes refs. */
async function cardCiting(s: Services, worldId: string, uri: string): Promise<Card | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const listed = await s.storage.list({
      worldId,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    const hit = listed.items.find((card) => cites(card, uri));
    if (hit) return hit;
    if (listed.nextCursor === undefined) return undefined;
    cursor = listed.nextCursor;
  }
  return undefined;
}

function askedQuery(query: Readonly<Record<string, unknown>>): FindingsQuery {
  return {
    ...(query['since'] ? { since: str(query['since']) } : {}),
    ...(query['text'] ? { text: str(query['text']) } : {}),
    ...(typeof query['limit'] === 'number' ? { limit: query['limit'] } : {}),
  };
}

async function reported(s: Services, query: FindingsQuery): Promise<Finding[]> {
  const all: Finding[] = [];
  let failures = 0;
  for (const connector of s.sources.values()) {
    try {
      all.push(...(await connector.findings(query)));
    } catch {
      failures += 1;
    }
  }
  if (s.sources.size > 0 && failures === s.sources.size) {
    throw new HttpError(502, 'a connected source did not answer');
  }
  return selectFindings(all, query);
}

export const sourceHandlers: Readonly<Record<string, Handler>> = {
  async findings_list(s, { query }) {
    return { status: 200, body: { findings: await reported(s, askedQuery(query)) } };
  },

  async finding_pin(s, { body }) {
    const req = body as FindingPinRequest;
    const connector = s.sources.get(req.connector);
    if (!connector) throw new HttpError(404, 'this source is not connected');
    const lage = await readLage(s, req.lageId);
    if (!lage || (await s.gate.decide(lage, 'screen')).decision !== 'allow') {
      throw new HttpError(404, 'unknown Lage');
    }
    const worldId = lage.worlds?.[0];
    if (!worldId) throw new HttpError(400, 'this Lage belongs to no world');

    let found: Finding | undefined;
    try {
      found = (await connector.findings({ uri: req.uri, limit: 1 }))[0];
    } catch {
      throw new HttpError(502, 'a connected source did not answer');
    }
    if (!found || found.uri !== req.uri)
      throw new HttpError(404, 'that finding is not in the source');
    const finding = found;

    let moved = false;
    const card = await s.writes.run(async () => {
      const current = await readLage(s, req.lageId);
      if (!current) throw new HttpError(409, 'the Lage does not exist');
      let stored = await cardCiting(s, worldId, finding.uri);
      if (!stored) {
        const draft = { ...connector.referenceCard(finding), worlds: [worldId] };
        const check = checkDraft(draft);
        if (!check.ok) throw new HttpError(400, `invalid card: ${check.message}`);
        const id = await s.storage.create(draft, 'human');
        stored = await s.storage.read(id);
        if (!stored) throw new HttpError(500, 'the card was not stored');
      }
      if (!current.lage.cards.some((place) => place.id === stored.id)) {
        const spot = freeSpot(current.lage);
        await writeLageVersion(s, req.lageId, (state) =>
          withPlacement(state, stored.id, spot.x, spot.y),
        );
        moved = true;
      }
      return stored;
    });
    if (moved) s.live.publish({ kind: 'move', lageId: req.lageId });
    return { status: 200, body: { card } };
  },
};
