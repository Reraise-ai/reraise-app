// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// An in-memory stand-in for the Board API, used as a fetch stub in the unit tests (the e2e
// against the real service comes in the next slice). It follows board-api.yaml: session header
// check, optimistic version guard (409), human-only decisions, change-cursor polling and the
// cloud transfer flow. Synthetic data only.

import type {
  Card,
  ContextPackage,
  Lage,
  Level1EngineInfo,
  Level1Prediction,
  Level1Trigger,
  Proposal,
  Stance,
  DisclosureTransfer,
  UsageMetrics,
} from '@worldbuilder/core';

export const TOKEN = 'test-session-token';
export const BASE = 'http://127.0.0.1:4310';

export const WORLD_ID = '01JA0000000000000000000W01';
const id = (n: string) => `01JA00000000000000000000${n}`;

export function makeCard(over: Partial<Card> & { id: string; title: string }): Card {
  return {
    externalId: over.id,
    uri: `wb:00000000-0000-4000-8000-000000000000/${over.id}`,
    format: 2,
    type: 'evidence',
    author: 'human',
    contentHash: `sha256:${'0'.repeat(64)}`,
    worlds: [WORLD_ID],
    visibility: 'private',
    ...over,
  } as Card;
}

export const CARDS: Card[] = [
  makeCard({
    id: id('C1'),
    title: 'Strait traffic report',
    layer: 'evidenced',
    source: 'Synthetic shipping bulletin',
    visibility: 'public',
    body: 'Daily transits fell by a third.',
  }),
  makeCard({
    id: id('C2'),
    title: 'Minister statement',
    layer: 'said',
    source: 'Synthetic press briefing',
    visibility: 'public',
  }),
  makeCard({
    id: id('C3'),
    title: 'My observation at the port',
    layer: 'experience',
    visibility: 'private',
  }),
  makeCard({
    id: id('C4'),
    title: 'Agent-found tanker rerouting',
    layer: 'evidenced',
    author: 'agent:scout',
    source: 'Synthetic tracker',
    visibility: 'public',
  }),
];

export const LAGE_ID = id('L1');

/** Two fictional actors and an assumption, for the level-1 panel tests (not on the default Lage). */
export const ORG_A = id('O1');
export const ORG_B = id('O2');
export const ASSUMPTION = id('A1');
export const LEVEL1_CARDS: Card[] = [
  makeCard({
    id: ORG_A,
    title: 'Coastal navy (fictional)',
    type: 'organisation',
    layer: 'said',
    originSystem: 'Synthetic desk',
    visibility: 'public',
  }),
  makeCard({
    id: ORG_B,
    title: 'Tanker consortium (fictional)',
    type: 'organisation',
    layer: 'said',
    originSystem: 'Synthetic desk',
    visibility: 'public',
  }),
  makeCard({
    id: ASSUMPTION,
    title: 'Assumption: the talks succeed',
    type: 'assumption',
    layer: 'said',
    originSystem: 'Synthetic desk',
    visibility: 'public',
  }),
];

export const LEVEL1_LOCAL: Level1EngineInfo = {
  engine: 'local-rules',
  label: 'Local rules engine',
  target: 'local_model',
  deterministic: true,
  available: true,
};
export const LEVEL1_CLOUD: Level1EngineInfo = {
  engine: 'scripted-cloud',
  label: 'Scripted cloud engine',
  target: 'cloud_model',
  deterministic: false,
  available: true,
};
export const LEVEL1_JEV: Level1EngineInfo = {
  engine: 'jev',
  label: 'Jev',
  target: 'cloud_model',
  deterministic: false,
  available: false,
  reason: 'not configured',
};

/** What the stand-in level-1 service knows. Replace `engines` to test other offers. */
export interface MockLevel1 {
  engines: Level1EngineInfo[];
  latest?: { prediction: Level1Prediction; key: string };
  /** Calls of `POST /lagen/<id>/level1`, with the engine they named and whether a transfer rode. */
  predicts: { engine: string; trigger: Level1Trigger; transferId?: string }[];
  /** How often a cloud engine was actually sent something. */
  cloudSends: number;
}

export function makeLage(over: Partial<Lage> = {}): Lage {
  return {
    question: 'Should the buyer reroute?',
    options: ['Reroute', 'Wait'],
    cards: [
      { id: id('C1'), x: 0, y: 0 },
      { id: id('C2'), x: 280, y: 0 },
    ],
    seats: [{ name: 'You', kind: 'human' }],
    edges: [],
    version: 1,
    updatedAt: '2026-10-06T10:00:00.000Z',
    ...over,
  };
}

export function makeUsage(): UsageMetrics {
  const counts = {
    tasks: 10,
    tasksWithReceipts: 6,
    consults: 8,
    consultsNothingFound: 1,
    writeBacks: 5,
    writeBacksNotNeeded: 2,
    cardsProposed: 4,
    decisionsProposed: 1,
    outcomesProposed: 0,
    cardsAccepted: 3,
    cardsRejected: 1,
    receiptCoverage: 0.6,
  };
  return {
    generatedAt: '2026-10-06T12:00:00.000Z',
    window: {
      kind: 'rolling_7d',
      start: '2026-09-29T12:00:00.000Z',
      end: '2026-10-06T12:00:00.000Z',
    },
    agents: [{ agent: 'agent:scout', ...counts }],
    totals: counts,
    decisions: { total: 4, withOutcome: 1 },
    atlas: { pages: 3, stalePages: 1, lagHours: 30 },
    targets: [
      { id: 'receipt_coverage_7d', comparison: 'at_least', threshold: 0.8, value: 0.6, met: false },
      { id: 'agent_cards_7d', comparison: 'at_least', threshold: 5, value: 3, met: false },
      { id: 'atlas_lag_hours', comparison: 'at_most', threshold: 24, value: 30, met: false },
      { id: 'decisions_with_outcome', comparison: 'at_least', threshold: 10, value: 1, met: false },
    ],
  };
}

export interface MockApi {
  fetch: typeof fetch;
  calls: { method: string; path: string; body?: unknown; headers: Record<string, string> }[];
  cards: Map<string, Card>;
  proposals: Proposal[];
  stances: Map<string, Stance>;
  transfers: Map<string, DisclosureTransfer & { token?: string; confirmed?: boolean }>;
  /** Simulates an agent proposal arriving over MCP. */
  addProposal(p: Omit<Proposal, 'id' | 'createdAt' | 'status'> & Partial<Proposal>): Proposal;
  level1: MockLevel1;
  /** What GET /metrics/usage answers; replace it to test other numbers. */
  usage: UsageMetrics;
  /** Simulates another writer bumping the Lage version. */
  bumpLage(lageId: string): void;
  /** The next request whose "METHOD /path" matches (default: any) answers with this problem. */
  failNext(status: number, title?: string, match?: RegExp, detail?: string): void;
}

function json(status: number, body: unknown, problem = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': problem ? 'application/problem+json' : 'application/json' },
  });
}
const problem = (status: number, title: string) => json(status, { title, status }, true);

export function createMockApi(initial: { lage?: Lage; cards?: Card[] } = {}): MockApi {
  const cards = new Map([...CARDS, ...(initial.cards ?? [])].map((c) => [c.id!, c] as const));
  const lageCard = (lage: Lage, cardId = LAGE_ID, title = 'Hormuz reroute'): Card =>
    makeCard({ id: cardId, title, type: 'lage', lage, layer: undefined, author: 'human' });
  cards.set(LAGE_ID, lageCard(initial.lage ?? makeLage()));

  let seq = 0;
  let changeSeq = 0;
  let fail: { status: number; title: string; match: RegExp; detail?: string } | undefined;
  const state: { proposalSeq: Map<string, number> } = { proposalSeq: new Map() };
  const api: MockApi = {
    calls: [],
    cards,
    proposals: [],
    stances: new Map(),
    transfers: new Map(),
    usage: makeUsage(),
    level1: { engines: [LEVEL1_LOCAL, LEVEL1_JEV], predicts: [], cloudSends: 0 },
    fetch: undefined as unknown as typeof fetch,
    addProposal(p) {
      const full = {
        id: id(`P${++seq}`),
        createdAt: new Date(Date.UTC(2026, 9, 6, 10, 0, seq)).toISOString(),
        status: 'pending',
        ...p,
      } as Proposal;
      api.proposals.push(full);
      state.proposalSeq.set(full.id, ++changeSeq);
      return full;
    },
    bumpLage(lageId) {
      const c = cards.get(lageId)!;
      cards.set(lageId, { ...c, lage: { ...c.lage!, version: c.lage!.version + 1 } });
    },
    failNext(status, title = 'forced failure', match = /./, detail) {
      fail = { status, title, match, ...(detail ? { detail } : {}) };
    },
  };

  const lageOf = (lageId: string) => cards.get(lageId)?.lage;

  function contextPackage(
    lageId: string | undefined,
    target: 'screen' | 'cloud_model',
    ids?: string[],
  ): ContextPackage {
    const lage = lageId ? lageOf(lageId) : undefined;
    const wanted = ids ?? lage?.cards.map((c) => c.id) ?? [];
    const items = wanted.flatMap((cid) => {
      const card = cards.get(cid);
      if (!card) return [];
      const stance = target === 'screen' ? api.stances.get(cid) : undefined;
      return [
        {
          card,
          provenance: {
            uri: card.uri!,
            originRoot: card.source ?? cid,
            originKnown: !!card.source,
          },
          gate: { decision: 'allow' as const, reason: 'cleared by the gate rules' },
          ...(stance ? { stance } : {}),
        },
      ];
    });
    return {
      id: id(`K${++seq}`),
      target,
      worldId: WORLD_ID,
      ...(lageId ? { lageId } : {}),
      createdAt: '2026-10-06T10:00:00.000Z',
      items,
      independence: {
        findings: items.length,
        origins: new Set(items.map((i) => i.provenance.originRoot)).size,
      },
      pendingProposals: [],
      withheld: 0,
    };
  }

  // ---- level 1 (the stand-in follows the contract, not the real engine) ----------------------
  const MOVES = ['Hold position', 'Escalate'] as const;
  /** What the request would be made of: the placed cards, assumption stances and content. */
  const level1Key = (lageId: string): string => {
    const lage = lageOf(lageId);
    if (!lage) return '';
    return JSON.stringify(
      lage.cards.map((c) => {
        const card = cards.get(c.id);
        const stance = card?.type === 'assumption' ? api.stances.get(c.id)?.position : undefined;
        if (stance === 'rejected') return null; // a rejected assumption is left out
        return [c.id, card?.contentHash, card?.body];
      }),
    );
  };
  const fakeHash = (key: string): string => {
    let h = 7;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `sha256:${h.toString(16).padStart(8, '0').repeat(8)}`;
  };
  const playersOf = (lageId: string): Card[] =>
    (lageOf(lageId)?.cards ?? [])
      .map((c) => cards.get(c.id))
      .filter((c): c is Card => c?.type === 'organisation');
  const rejectedCount = (lageId: string): number =>
    (lageOf(lageId)?.cards ?? []).filter(
      (c) =>
        cards.get(c.id)?.type === 'assumption' && api.stances.get(c.id)?.position === 'rejected',
    ).length;
  function predictionFor(lageId: string, engine: string, trigger: Level1Trigger): Level1Prediction {
    const flipped = rejectedCount(lageId) > 0;
    return {
      engine,
      lageId,
      trigger,
      requestHash: fakeHash(`${level1Key(lageId)}|${JSON.stringify(trigger)}`),
      players: playersOf(lageId).map((c) => ({
        playerCardId: c.id!,
        moveOptions: [...MOVES],
        predictedMove: flipped ? MOVES[1] : MOVES[0],
        confidence: flipped ? 0.71 : 0.58,
        cardIds: [
          c.id!,
          ...(lageOf(lageId)
            ?.cards.map((x) => x.id)
            .filter((x) => x !== c.id) ?? []),
        ].slice(0, 3),
      })),
      predictedAt: '2026-10-07T10:00:00.000Z',
    };
  }
  /** `stale` as the service computes it: the request key (trigger left out) differs. */
  const isStale = (lageId: string): boolean =>
    !api.level1.latest || api.level1.latest.key !== level1Key(lageId);
  function basisFor(lageId: string, prediction: Level1Prediction) {
    return {
      engine: prediction.engine,
      requestHash: prediction.requestHash,
      players: prediction.players.map((p) => ({
        playerCardId: p.playerCardId,
        temperature: 0.5,
        weights: {},
        options: p.moveOptions.map((move) => ({
          move,
          excluded: false,
          redLineHits: [],
          features: {
            behaviour: {
              value: move === p.predictedMove ? 1 : 0,
              via: [p.cardIds[1] ?? p.playerCardId],
            },
            interest: { value: move === p.predictedMove ? 0.5 : 0, via: [p.playerCardId] },
          },
          contributions: { behaviour: move === p.predictedMove ? 1 : 0, interest: 0.25 },
          score: move === p.predictedMove ? 1.25 : 0.25,
          probability: move === p.predictedMove ? p.confidence : 1 - p.confidence,
        })),
        firedRuleCardIds: [],
        evidenceKinds: 2,
        statementBehaviourDivergence: false,
        allExcluded: false,
        predictedMove: p.predictedMove,
        confidence: p.confidence,
        cardIds: p.cardIds,
      })),
    };
  }

  api.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    api.calls.push({ method, path: url.pathname + url.search, body, headers });
    if (headers['x-worldbuilder-session'] !== TOKEN) return problem(401, 'Unauthorized');
    if (fail?.match.test(`${method} ${url.pathname}`)) {
      const f = fail;
      fail = undefined;
      return f.detail
        ? json(f.status, { title: f.title, status: f.status, detail: f.detail }, true)
        : problem(f.status, f.title);
    }
    const p = url.pathname;
    let m: RegExpMatchArray | null;

    if (p === '/metrics/usage' && method === 'GET') {
      const week = url.searchParams.get('week');
      if (week && !/^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(week))
        return problem(400, 'bad week');
      return json(200, api.usage);
    }
    if (p === '/worlds' && method === 'GET') {
      return json(200, { worlds: [{ id: WORLD_ID, name: 'Hormuz (synthetic)' }] });
    }
    if (p === '/lagen' && method === 'POST') {
      const req = body as { title: string; lage: Lage };
      const card = lageCard(req.lage, id(`L${++seq}`), req.title);
      cards.set(card.id!, card);
      return json(201, card);
    }
    if ((m = p.match(/^\/lagen\/([^/]+)\/level1$/))) {
      const lageId = m[1]!;
      if (!lageOf(lageId)) return problem(404, 'Not found');
      if (method === 'GET') {
        const latest = api.level1.latest;
        const stale = isStale(lageId);
        const explain = url.searchParams.get('explain') === 'true';
        return json(200, {
          lageId,
          engines: api.level1.engines,
          ...(latest ? { prediction: latest.prediction, stale } : {}),
          ...(latest && explain && !stale && latest.prediction.engine === 'local-rules'
            ? { basis: basisFor(lageId, latest.prediction) }
            : {}),
        });
      }
      if (method === 'POST') {
        const req = body as {
          engine: string;
          trigger: Level1Trigger;
          transferId?: string;
          confirmationToken?: string;
        };
        api.level1.predicts.push({
          engine: req.engine,
          trigger: req.trigger,
          ...(req.transferId ? { transferId: req.transferId } : {}),
        });
        const info = api.level1.engines.find(
          (e) => e.engine === req.engine || (req.engine === 'local' && e.target === 'local_model'),
        );
        if (!info) return problem(404, 'unknown engine');
        if (!info.available) return problem(409, 'engine not available');
        if (playersOf(lageId).length === 0)
          return json(200, { status: 'no_players', engine: info.engine });
        if (info.target === 'cloud_model') {
          if (!req.transferId) {
            const objects = (lageOf(lageId)?.cards ?? []).map((c) => cards.get(c.id)!);
            const transfer = {
              transferId: id(`T${++seq}`),
              purpose: 'level1',
              cardIds: objects.map((c) => c.id!),
              payloadHash: `sha256:${'b'.repeat(64)}`,
              preview: {
                target: 'cloud_model',
                connectorId: info.engine,
                request: {
                  question: lageOf(lageId)!.question,
                  options: playersOf(lageId).flatMap((c) => MOVES.map((mv) => `${c.id}: ${mv}`)),
                  outputSchema: { type: 'object' },
                },
                objects,
              },
              createdAt: '2026-10-06T10:00:00.000Z',
              expiresAt: '2026-10-06T10:05:00.000Z',
              requestedBy: 'board',
            } as unknown as DisclosureTransfer;
            api.transfers.set(transfer.transferId, transfer);
            return json(200, { status: 'confirmation_required', engine: info.engine, transfer });
          }
          const t = api.transfers.get(req.transferId);
          if (!t || !t.confirmed || t.token !== req.confirmationToken) {
            return problem(403, 'unknown, expired or unconfirmed transfer');
          }
          t.token = undefined; // single use
          api.level1.cloudSends++;
        }
        const previous = api.level1.latest?.prediction;
        const prediction = predictionFor(lageId, info.engine, req.trigger);
        api.level1.latest = { prediction, key: level1Key(lageId) };
        const changes = (previous?.players ?? []).flatMap((was) => {
          const now = prediction.players.find((x) => x.playerCardId === was.playerCardId);
          return now && now.predictedMove !== was.predictedMove
            ? [
                {
                  playerCardId: now.playerCardId,
                  from: was.predictedMove,
                  to: now.predictedMove,
                  confidenceFrom: was.confidence,
                  confidenceTo: now.confidence,
                },
              ]
            : [];
        });
        return json(200, {
          status: 'predicted',
          engine: info.engine,
          prediction,
          ...(changes.length > 0 ? { changes } : {}),
        });
      }
    }
    if ((m = p.match(/^\/lagen\/([^/]+)\/level1\/escalate$/)) && method === 'POST') {
      const lageId = m[1]!;
      const latest = api.level1.latest;
      if (!latest || isStale(lageId)) return problem(409, 'no current prediction');
      const playerCardId = (body as { playerCardId: string }).playerCardId;
      const player = latest.prediction.players.find((x) => x.playerCardId === playerCardId);
      if (!player) return problem(404, 'no such player');
      const card = makeCard({
        id: id(`L${++seq}`),
        title: `Next move of ${cards.get(playerCardId)?.title}`,
        type: 'lage',
        layer: undefined,
        edges: [{ target: lageId, kind: 'based_on', by: 'human' }],
        lage: makeLage({
          question: `What is the most likely next move of ${cards.get(playerCardId)?.title}?`,
          options: player.moveOptions,
          cards: player.cardIds.map((cid, i) => ({ id: cid, x: i * 220, y: 80 })),
        }),
      });
      cards.set(card.id!, card);
      return json(201, card);
    }
    if ((m = p.match(/^\/lagen\/([^/]+)$/))) {
      const lageId = m[1]!;
      const card = cards.get(lageId);
      if (!card?.lage) return problem(404, 'Not found');
      if (method === 'GET') return json(200, card);
      if (method === 'PUT') {
        const next = body as Lage;
        if (next.version !== card.lage.version + 1) return problem(409, 'version conflict');
        const saved = { ...card, lage: next };
        cards.set(lageId, saved);
        return json(200, saved);
      }
    }
    if (p === '/cards' && method === 'GET') {
      const text = url.searchParams.get('text')?.toLowerCase();
      const type = url.searchParams.get('type');
      const layer = url.searchParams.get('layer');
      const found = [...cards.values()].filter(
        (c) =>
          (!type || c.type === type) &&
          (!layer || c.layer === layer) &&
          (!text || `${c.title} ${c.body ?? ''}`.toLowerCase().includes(text)),
      );
      return json(200, { cards: found });
    }
    if ((m = p.match(/^\/cards\/([^/]+)$/)) && method === 'GET') {
      const c = cards.get(m[1]!);
      return c ? json(200, c) : problem(404, 'Not found');
    }
    if ((m = p.match(/^\/cards\/([^/]+)\/stance$/))) {
      const cid = m[1]!;
      if (!cards.has(cid)) return problem(404, 'Not found');
      if (method === 'GET') {
        const s = api.stances.get(cid);
        return s ? json(200, s) : problem(404, 'no stance');
      }
      if (method === 'PUT') {
        const prev = api.stances.get(cid);
        const input = body as { position: Stance['position']; weight: number; note?: string };
        const stance: Stance = {
          cardId: cid,
          ...input,
          updatedAt: '2026-10-06T11:00:00.000Z',
          history: prev
            ? [
                ...prev.history,
                { position: prev.position, weight: prev.weight, updatedAt: prev.updatedAt },
              ]
            : [],
        };
        api.stances.set(cid, stance);
        return json(200, stance);
      }
    }
    if (p === '/context-packages' && method === 'POST') {
      const req = body as { lageId?: string; transferId?: string; confirmationToken?: string };
      if (req.transferId) {
        const t = api.transfers.get(req.transferId);
        if (!t || t.token !== req.confirmationToken) return problem(403, 'transfer not confirmed');
        const pkg = contextPackage(req.lageId, 'cloud_model', t.cardIds);
        return json(200, {
          ...pkg,
          transfer: {
            transferId: t.transferId,
            payloadHash: t.payloadHash,
            cardIds: t.cardIds,
            confirmedAt: '2026-10-06T11:00:00.000Z',
          },
        });
      }
      return json(200, contextPackage(req.lageId, 'screen'));
    }
    if (p === '/proposals' && method === 'GET') {
      const lageId = url.searchParams.get('lageId');
      const since = url.searchParams.get('changedSince');
      const after = since ? Number(since) : 0;
      const changed = api.proposals.filter(
        (x) =>
          (state.proposalSeq.get(x.id) ?? 0) > after &&
          (!lageId || (x.payload as { lageId?: string }).lageId === lageId),
      );
      return json(200, { proposals: changed, nextCursor: String(changeSeq) });
    }
    if ((m = p.match(/^\/proposals\/([^/]+)\/(accept|reject)$/)) && method === 'POST') {
      const prop = api.proposals.find((x) => x.id === m![1]);
      if (!prop) return problem(404, 'Not found');
      if (prop.status !== 'pending') return problem(409, 'already decided');
      if (m[2] === 'accept' && prop.kind === 'place_card') {
        const pl = prop.payload as { lageId: string; cardId: string; x: number; y: number };
        const c = cards.get(pl.lageId)!;
        cards.set(pl.lageId, {
          ...c,
          lage: {
            ...c.lage!,
            version: c.lage!.version + 1,
            cards: [...c.lage!.cards, { id: pl.cardId, x: pl.x, y: pl.y }],
          },
        });
      }
      prop.status = m[2] === 'accept' ? 'accepted' : 'rejected';
      prop.decidedBy = 'human';
      prop.decidedAt = '2026-10-06T11:00:00.000Z';
      state.proposalSeq.set(prop.id, ++changeSeq);
      return json(200, prop);
    }
    if (p === '/disclosure/transfers' && method === 'POST') {
      const req = body as {
        cardIds: string[];
        connectorId: string;
        request: Record<string, unknown>;
      };
      const cleared = req.cardIds.filter((cid) => cards.get(cid)?.visibility === 'public');
      if (cleared.length === 0)
        return problem(400, 'no card of this transfer is cleared for cloud_model');
      const transfer: DisclosureTransfer = {
        transferId: id(`T${++seq}`),
        purpose: 'context_package',
        cardIds: cleared,
        payloadHash: `sha256:${'a'.repeat(64)}`,
        preview: {
          target: 'cloud_model',
          connectorId: req.connectorId,
          request: req.request,
          objects: cleared.map((cid) => cards.get(cid)!) as [Card, ...Card[]],
        },
        createdAt: '2026-10-06T10:00:00.000Z',
        expiresAt: '2026-10-06T10:05:00.000Z',
        requestedBy: 'board',
      } as DisclosureTransfer;
      api.transfers.set(transfer.transferId, transfer);
      return json(201, transfer);
    }
    if ((m = p.match(/^\/disclosure\/transfers\/([^/]+)\/confirm$/)) && method === 'POST') {
      const t = api.transfers.get(m[1]!);
      if (!t) return problem(404, 'Not found');
      if (t.confirmed) return problem(409, 'already confirmed');
      if ((body as { payloadHash: string }).payloadHash !== t.payloadHash)
        return problem(409, 'hash mismatch');
      t.confirmed = true;
      t.token = `confirm-token-${seq++}`;
      return json(200, {
        transferId: t.transferId,
        payloadHash: t.payloadHash,
        cardIds: t.cardIds,
        token: t.token,
        tokenExpiresAt: '2026-10-06T10:05:00.000Z',
        confirmedBy: 'human',
        confirmedAt: '2026-10-06T10:01:00.000Z',
      });
    }
    return problem(404, `no route ${method} ${p}`);
  }) as typeof fetch;
  return api;
}
