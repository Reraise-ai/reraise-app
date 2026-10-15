// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// BoardClient for the static demo build. The start world is JSON. Edits stay in this
// browser (localStorage). Nothing is sent to a Board API.

import type {
  Card,
  ContextPackage,
  FindingPinRequest,
  FindingsListRequest,
  Lage,
  LageCreateRequest,
  LageVersion,
  ScenarioAssumption,
  ScenarioLayer,
  ScenarioReplace,
  Stance,
  StanceInput,
  World,
} from '@worldbuilder/core';
import { buildUri, encodeUlid } from '@worldbuilder/core/ids';
import { ApiError, type BoardClient } from '../api/client.js';

const KEY = 'wb.demo.v1';

export interface DemoSeed {
  synthetic: true;
  stamp: string;
  storeInstanceId: string;
  worlds: World[];
  cards: Card[];
  versions: Record<string, LageVersion[]>;
}

interface Saved {
  stamp: string;
  cards: Card[];
  versions: Record<string, LageVersion[]>;
  stances: Stance[];
  scenarios: Record<string, ScenarioAssumption[]>;
}

export interface DemoClient extends BoardClient {
  /** Drop the browser copy and return to the start world. */
  reset(): void;
}

function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}

function unsupported(): never {
  fail(501, 'The demo build keeps this board in the browser and does not run that operation.');
}

function mintUlid(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  let t = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  crypto.getRandomValues(bytes.subarray(6));
  return encodeUlid(bytes);
}

function haystack(card: Card): string {
  return [card.title, card.body, card.source, card.originSystem]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
    .toLowerCase();
}

function readSaved(storage: Storage | undefined, stamp: string): Saved | undefined {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as Saved;
    if (saved.stamp !== stamp || !Array.isArray(saved.cards)) return undefined;
    return saved;
  } catch {
    return undefined;
  }
}

/** A BoardClient over one JSON world. `storage` keeps edits across reloads of this browser. */
export function createMemoryClient(seed: DemoSeed, storage?: Storage): DemoClient {
  let cards = new Map<string, Card>();
  let versions = new Map<string, LageVersion[]>();
  let stances = new Map<string, Stance>();
  let scenarios = new Map<string, ScenarioAssumption[]>();

  const apply = (saved?: Saved): void => {
    const sourceCards = saved?.cards ?? seed.cards;
    const sourceVersions = saved?.versions ?? seed.versions;
    cards = new Map(
      sourceCards.filter((card) => card.id).map((card) => [card.id!, structuredClone(card)]),
    );
    versions = new Map(
      Object.entries(sourceVersions).map(([id, list]) => [id, structuredClone(list)]),
    );
    stances = new Map(
      (saved?.stances ?? []).map((stance) => [stance.cardId, structuredClone(stance)]),
    );
    scenarios = new Map(
      Object.entries(saved?.scenarios ?? {}).map(([id, list]) => [id, structuredClone(list)]),
    );
  };

  const persist = (): void => {
    const saved: Saved = {
      stamp: seed.stamp,
      cards: [...cards.values()],
      versions: Object.fromEntries(versions),
      stances: [...stances.values()],
      scenarios: Object.fromEntries(scenarios),
    };
    try {
      storage?.setItem(KEY, JSON.stringify(saved));
    } catch {
      // The tab still has the edit. A full disk does not roll it back.
    }
  };

  apply(readSaved(storage, seed.stamp));

  const lageCard = (id: string): Card => {
    const card = cards.get(id);
    if (!card?.lage || !card.id) fail(404, 'unknown Lage');
    return card;
  };

  const client: BoardClient = {
    world_list: async () => ({ worlds: structuredClone(seed.worlds) }),
    lage_create: async (body: LageCreateRequest) => {
      if (body.lage.version !== 1) fail(400, 'a new Lage starts at version 1');
      const id = mintUlid();
      const card: Card = {
        id,
        externalId: id,
        uri: buildUri(seed.storeInstanceId, id),
        format: 2,
        type: 'lage',
        title: body.title,
        author: 'human',
        contentHash: `sha256:${'0'.repeat(64)}`,
        ...(body.worlds ? { worlds: body.worlds } : {}),
        visibility: 'private',
        lage: body.lage,
      };
      cards.set(id, card);
      persist();
      return structuredClone(card);
    },
    decision_create: async () => unsupported(),
    decision_save: async () => unsupported(),
    lage_get: async (id) => structuredClone(lageCard(id)),
    lage_save: async (id, next: Lage) => {
      const card = lageCard(id);
      const stored = card.lage!;
      if (next.version !== stored.version + 1) {
        fail(
          409,
          `version conflict: the stored version is ${stored.version}, expected ${stored.version + 1}`,
        );
      }
      const archived = versions.get(id) ?? [];
      archived.push({
        version: stored.version,
        archivedAt: new Date().toISOString(),
        lage: stored,
      });
      versions.set(id, archived);
      const updated: Card = { ...card, lage: next };
      cards.set(id, updated);
      persist();
      return structuredClone(updated);
    },
    lage_versions: async (id) => {
      lageCard(id);
      return { versions: structuredClone(versions.get(id) ?? []) };
    },
    cards_search: async (params = {}) => {
      const tokens = (params.text ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t !== '');
      const limit = params.limit ?? 50;
      // shortcut: one page, no cursor; upgrade when a demo world needs a second page.
      const found = [...cards.values()].filter((card) => {
        if (params.worldId && !card.worlds?.includes(params.worldId)) return false;
        if (params.type && card.type !== params.type) return false;
        if (params.layer && card.layer !== params.layer) return false;
        const text = haystack(card);
        return tokens.every((token) => text.includes(token));
      });
      found.sort((a, b) => (a.id! < b.id! ? -1 : 1));
      return { cards: structuredClone(found.slice(0, limit)) };
    },
    card_get: async (id) => {
      const card = cards.get(id);
      if (!card) fail(404, 'unknown card');
      return structuredClone(card);
    },
    stance_get: async (id) => {
      const stance = stances.get(id);
      if (!stance) fail(404, 'no stance on this card');
      return structuredClone(stance);
    },
    stance_save: async (id, input: StanceInput) => {
      if (!cards.has(id)) fail(404, 'unknown card');
      const prev = stances.get(id);
      const now = new Date().toISOString();
      const stance: Stance = {
        cardId: id,
        position: input.position,
        weight: input.weight,
        ...(input.note ? { note: input.note } : {}),
        updatedAt: now,
        history: prev
          ? [
              ...prev.history,
              {
                position: prev.position,
                weight: prev.weight,
                ...(prev.note ? { note: prev.note } : {}),
                updatedAt: prev.updatedAt,
              },
            ]
          : [],
      };
      stances.set(id, stance);
      persist();
      return structuredClone(stance);
    },
    context_package_get: async (body): Promise<ContextPackage> => {
      const items = [...cards.values()]
        .filter((card) => card.id)
        .map((card) => {
          const stance = card.id ? stances.get(card.id) : undefined;
          const origin = card.originSystem || card.source || card.id || 'unknown';
          return {
            card: structuredClone(card),
            provenance: {
              uri: card.uri,
              ...(card.source ? { source: card.source } : {}),
              ...(card.originSystem ? { originSystem: card.originSystem } : {}),
              originRoot: origin,
              originKnown: Boolean(card.originSystem || card.source),
            },
            gate: { decision: 'allow' as const, reason: 'demo build, on this device' },
            ...(stance ? { stance: structuredClone(stance) } : {}),
          };
        });
      const origins = new Set(items.map((item) => item.provenance.originRoot));
      const lage = body.lageId ? cards.get(body.lageId)?.lage : undefined;
      return {
        id: mintUlid(),
        target: 'screen',
        worldId: body.worldId,
        ...(body.lageId ? { lageId: body.lageId } : {}),
        ...(lage ? { question: lage.question } : {}),
        createdAt: new Date().toISOString(),
        items: body.maxItems ? items.slice(0, body.maxItems) : items,
        independence: { findings: items.length, origins: origins.size },
        pendingProposals: [],
        withheld: 0,
      };
    },
    proposal_list: async () => ({ proposals: [] }),
    proposal_accept: async () => unsupported(),
    proposal_reject: async () => unsupported(),
    disclosure_transfer_preview: async () => unsupported(),
    disclosure_confirm: async () => unsupported(),
    level1_get: async (lageId) => {
      lageCard(lageId);
      return {
        lageId,
        engines: [
          {
            engine: 'local-rules',
            label: 'Local rules engine',
            target: 'local_model' as const,
            deterministic: true,
            available: false,
            reason: 'The demo build does not run an engine.',
          },
        ],
      };
    },
    level1_predict: async () => ({ status: 'no_players' as const, engine: 'local-rules' }),
    level1_escalate: async () => unsupported(),
    model_ask: async () => unsupported(),
    findings_list: async (_params?: FindingsListRequest) => ({ findings: [] }),
    finding_pin: async (_body: FindingPinRequest) => unsupported(),
    usage_metrics_get: async () => unsupported(),
    // shortcut: the service evaluates rules; this demo returns none. Upgrade when the demo must show fired rules.
    rules_evaluate: async ({ lageId }) => {
      const card = lageCard(lageId);
      return {
        lageId,
        lageVersion: card.lage!.version,
        target: 'screen' as const,
        evaluatedAt: new Date().toISOString(),
        results: [],
        withheld: 0,
      };
    },
    rule_create: async () => unsupported(),
    rule_save: async () => unsupported(),
    source_profile_get: async () => fail(404, 'no profile'),
    scenario_get: async (lageId): Promise<ScenarioLayer> => {
      lageCard(lageId);
      return { assumptions: structuredClone(scenarios.get(lageId) ?? []) };
    },
    scenario_replace: async (lageId, body: ScenarioReplace) => {
      lageCard(lageId);
      const seen = new Set<string>();
      const assumptions: ScenarioAssumption[] = [];
      for (const item of body.assumptions) {
        const statement = item.statement.trim();
        if (!statement || seen.has(statement)) continue;
        seen.add(statement);
        assumptions.push({ id: mintUlid(), statement });
      }
      if (assumptions.length > 20) fail(400, 'at most 20 assumptions');
      scenarios.set(lageId, assumptions);
      persist();
      return { assumptions: structuredClone(assumptions) };
    },
    scenario_attach: async () => unsupported(),
    scenario_attachment_get: async () => unsupported(),
    training_export: async () => unsupported(),
    openEvents: (_lageId, signal) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const stop = (): void => {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };
          if (signal.aborted) {
            stop();
            return;
          }
          signal.addEventListener('abort', stop, { once: true });
        },
      });
      return Promise.resolve(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    },
  };

  return {
    ...client,
    reset() {
      try {
        storage?.removeItem(KEY);
      } catch {
        /* the next apply still drops the copy */
      }
      apply();
    },
  };
}
