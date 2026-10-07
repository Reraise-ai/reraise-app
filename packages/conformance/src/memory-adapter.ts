// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// In-memory fake StorageAdapter. It exists so that the conformance kit itself is tested
// (ADR-0005: in M0 the kit runs against an in-memory fake). It is not a product backend.
//
// The fake keeps each card as text, one `field: <JSON>` line per field, in the order the
// store wrote them, like the front matter of a card file. Fields it does not know stay
// untouched. It can run with native ULIDs (like markdown-files) or with store-local ids and
// derived canonical ids (like a foreign store).

import type {
  ArchivedVersion,
  Card,
  CardDraft,
  CardId,
  CardListQuery,
  CardPatch,
  CardSearchQuery,
  KnownAuthor,
  Page,
  Stance,
  StorageAdapter,
  StorageCapabilities,
  World,
  WriteGuard,
} from '@worldbuilder/core';
import {
  buildUri,
  computeContentHash,
  deriveCardId,
  encodeUlid,
  StorageError,
} from '@worldbuilder/core';
import type { StorageAdapterHarness } from './storage.js';
import { schemaValidator } from './validate.js';

const validateDraft = schemaValidator(
  'https://worldbuilder.invalid/schemas/v0/card.schema.json#/$defs/draft',
);

/** Canonical card fields the fake understands; everything else is a foreign store field. */
const CONTENT_FIELDS = new Set([
  'format',
  'collection',
  'type',
  'typeRaw',
  'title',
  'body',
  'date',
  'source',
  'sourceDate',
  'sourceChecksum',
  'contentHash',
  'status',
  'rating',
  'release',
  'carrier',
  'affiliation',
  'visibility',
  'class',
  'layer',
  'worlds',
  'tags',
  'author',
  'originSystem',
  'training',
  'edges',
  'interests',
  'capabilities',
  'dependencies',
  'moves',
  'redLines',
  'assumedGoals',
  'personalityType',
  'lage',
  'sections',
  'rule',
]);
const NOT_PATCHABLE = new Set(['format', 'author', 'contentHash']);
const FORMAT_2_FIELDS = [
  'layer',
  'worlds',
  'author',
  'originSystem',
  'training',
  'edges',
  'interests',
  'capabilities',
  'dependencies',
  'moves',
  'redLines',
  'assumedGoals',
  'personalityType',
];
/** Legacy store fields of the fake that carry stance data (like a believed layer). */
const LEGACY_BELIEVED = 'believed';
const LEGACY_ASSESSMENT = 'assessment';

interface Stored {
  lines: string[];
}

/** Shared state of one fake store; several adapter instances can open it. */
export class MemoryStore {
  readonly cards = new Map<string, Stored>();
  readonly archive = new Map<string, ArchivedVersion[]>();
  readonly worlds: World[] = [];
  private counter = 0;

  constructor(
    readonly storeInstanceId: string,
    readonly ids: StorageCapabilities['ids'] = 'native',
  ) {}

  /** Next store-local id: a minted ULID (native) or `c-<n>` (foreign id scheme). */
  nextExternalId(): string {
    this.counter++;
    if (this.ids === 'derived') return `c-${this.counter}`;
    // 128 random bits always encode below 2^128, the ULID range.
    return encodeUlid(crypto.getRandomValues(new Uint8Array(16)));
  }

  /** A copy of the whole store, as if its files were moved to another machine or folder. */
  copy(): MemoryStore {
    const other = new MemoryStore(this.storeInstanceId, this.ids);
    for (const [k, v] of this.cards) other.cards.set(k, { lines: [...v.lines] });
    for (const [k, v] of this.archive) other.archive.set(k, structuredClone(v));
    other.worlds.push(...structuredClone(this.worlds));
    other.counter = this.counter;
    return other;
  }

  /** Write raw lines directly, as another tool would. Returns the canonical id. */
  seed(externalId: string, fields: Record<string, unknown>): CardId {
    this.cards.set(externalId, { lines: Object.entries(fields).map(([k, v]) => line(k, v)) });
    return this.idOf(externalId);
  }

  idOf(externalId: string): CardId {
    return this.ids === 'native'
      ? externalId
      : deriveCardId(buildUri(this.storeInstanceId, externalId));
  }

  /** Find the store-local id of a canonical id. */
  externalIdOf(id: CardId): string | undefined {
    for (const externalId of this.cards.keys()) if (this.idOf(externalId) === id) return externalId;
    for (const externalId of this.archive.keys())
      if (this.idOf(externalId) === id) return externalId;
    return undefined;
  }
}

const line = (key: string, value: unknown) => `${key}: ${JSON.stringify(value)}`;

function parseLines(lines: readonly string[]): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  for (const l of lines) {
    const i = l.indexOf(': ');
    fields.set(l.slice(0, i), JSON.parse(l.slice(i + 2)));
  }
  return fields;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly capabilities: StorageCapabilities;

  constructor(private readonly store: MemoryStore) {
    this.capabilities = { write: true, search: true, ids: store.ids };
  }

  get storeInstanceId(): string {
    return this.store.storeInstanceId;
  }

  private toCard(externalId: string, stored: Stored): Card {
    const fields = parseLines(stored.lines);
    const raw = Object.fromEntries(fields);
    const card: Record<string, unknown> = {};
    for (const [k, v] of fields) if (CONTENT_FIELDS.has(k)) card[k] = v;
    // Legacy believed marker (ADR-0008): said, by the user; the stance is read separately.
    if (raw[LEGACY_BELIEVED] === true) {
      card['layer'] = 'said';
      card['author'] ??= 'human';
    }
    const format =
      (card['format'] as number | undefined) ?? (FORMAT_2_FIELDS.some((f) => f in raw) ? 2 : 1);
    card['format'] = format;
    if (card['author'] === undefined && format === 1) card['author'] = 'unknown';
    card['training'] ??= false;
    const result = {
      ...card,
      id: this.store.idOf(externalId),
      externalId,
      uri: buildUri(this.store.storeInstanceId, externalId),
    } as Card;
    // The hash is always computed from the content, never trusted from storage (ADR-0034).
    return { ...result, contentHash: computeContentHash(result) };
  }

  async read(id: CardId): Promise<Card | undefined> {
    const externalId = this.store.externalIdOf(id);
    const stored = externalId === undefined ? undefined : this.store.cards.get(externalId);
    return stored && externalId !== undefined ? this.toCard(externalId, stored) : undefined;
  }

  async list(query: CardListQuery = {}): Promise<Page<Card>> {
    const all = [...this.store.cards].map(([e, s]) => this.toCard(e, s));
    return page(
      all.filter((c) => !query.worldId || c.worlds?.includes(query.worldId)),
      query,
    );
  }

  async search(query: CardSearchQuery): Promise<Page<Card>> {
    const text = query.text?.toLowerCase();
    const all = (await this.list({ worldId: query.worldId, limit: Number.MAX_SAFE_INTEGER })).items;
    return page(
      all.filter(
        (c) =>
          (!text || `${c.title}\n${c.body ?? ''}`.toLowerCase().includes(text)) &&
          (!query.type || c.type === query.type) &&
          (!query.layer || c.layer === query.layer),
      ),
      query,
    );
  }

  async listWorlds(): Promise<readonly World[]> {
    return [...this.store.worlds];
  }

  async create(draft: CardDraft, author: KnownAuthor): Promise<CardId> {
    if (!validateDraft(draft)) {
      throw new StorageError(
        'invalid',
        `invalid card draft: ${JSON.stringify(validateDraft.errors)}`,
      );
    }
    // A draft's contentHash is not stored: the hash is recomputed on every read.
    const content: Record<string, unknown> = { ...draft, author };
    delete content['contentHash'];
    return this.store.seed(this.store.nextExternalId(), content);
  }

  async patch(id: CardId, patch: CardPatch, guard: WriteGuard = {}): Promise<void> {
    const externalId = this.store.externalIdOf(id);
    const stored = externalId === undefined ? undefined : this.store.cards.get(externalId);
    if (!stored || externalId === undefined)
      throw new StorageError('not_found', `unknown card ${id}`);
    const keys = Object.keys(patch);
    this.assertKnown(keys);
    const blocked = keys.filter((k) => NOT_PATCHABLE.has(k));
    if (blocked.length > 0) throw new StorageError('invalid', `cannot patch ${blocked.join(', ')}`);

    const current = this.toCard(externalId, stored);
    if (guard.contentHash !== undefined && guard.contentHash !== current.contentHash) {
      throw new StorageError(
        'conflict',
        `content changed: stored ${current.contentHash}, expected ${guard.contentHash}`,
      );
    }
    if (patch.lage) {
      const version = current.lage?.version;
      if (guard.lageVersion !== undefined && guard.lageVersion !== version) {
        throw new StorageError(
          'conflict',
          `version conflict: stored ${version}, expected ${guard.lageVersion}`,
        );
      }
      if (version !== undefined && patch.lage.version !== version + 1) {
        throw new StorageError('invalid', 'a new Lage version must be the stored version plus one');
      }
      this.pushVersion(externalId, current);
    }
    const lines = [...stored.lines];
    for (const [key, value] of Object.entries(patch)) {
      const at = lines.findIndex((l) => l.startsWith(`${key}: `));
      if (value === undefined) {
        if (at >= 0) lines.splice(at, 1);
      } else if (at >= 0) {
        lines[at] = line(key, value);
      } else {
        lines.push(line(key, value));
      }
    }
    this.store.cards.set(externalId, { lines });
  }

  async archive(id: CardId): Promise<void> {
    const externalId = this.store.externalIdOf(id);
    const stored = externalId === undefined ? undefined : this.store.cards.get(externalId);
    if (!stored || externalId === undefined)
      throw new StorageError('not_found', `unknown card ${id}`);
    this.pushVersion(externalId, this.toCard(externalId, stored));
    this.store.cards.delete(externalId);
  }

  async versions(id: CardId): Promise<readonly ArchivedVersion[]> {
    const externalId = this.store.externalIdOf(id);
    return externalId === undefined ? [] : [...(this.store.archive.get(externalId) ?? [])];
  }

  async readLegacyStance(id: CardId): Promise<Stance | undefined> {
    const externalId = this.store.externalIdOf(id);
    const stored = externalId === undefined ? undefined : this.store.cards.get(externalId);
    if (!stored) return undefined;
    const raw = parseLines(stored.lines);
    const note = raw.get(LEGACY_ASSESSMENT) as string | undefined;
    const believed = raw.get(LEGACY_BELIEVED) === true;
    if (!believed && note === undefined) return undefined;
    return {
      cardId: id,
      position: believed ? 'believed' : 'undecided',
      weight: 2,
      ...(note === undefined ? {} : { note }),
      updatedAt: '1970-01-01T00:00:00Z',
      history: [],
    };
  }

  private assertKnown(keys: readonly string[]): void {
    const unknown = keys.filter((k) => !CONTENT_FIELDS.has(k));
    if (unknown.length > 0)
      throw new StorageError('invalid', `not a canonical card field: ${unknown.join(', ')}`);
  }

  private pushVersion(externalId: string, card: Card): void {
    const versions = this.store.archive.get(externalId) ?? [];
    versions.push({ version: versions.length + 1, archivedAt: new Date().toISOString(), card });
    this.store.archive.set(externalId, versions);
  }
}

function page(items: Card[], query: CardListQuery): Page<Card> {
  const start = Number(query.cursor ?? 0);
  const limit = query.limit ?? 50;
  const slice = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : undefined;
  return next === undefined ? { items: slice } : { items: slice, nextCursor: next };
}

/** A conformance harness over a fresh in-memory store. */
export function memoryHarness(ids: StorageCapabilities['ids'] = 'native'): StorageAdapterHarness {
  const store = new MemoryStore(crypto.randomUUID(), ids);
  return {
    adapter: new MemoryStorageAdapter(store),
    reopen: async () => new MemoryStorageAdapter(store),
    relocate: async () => new MemoryStorageAdapter(store.copy()),
    raw: async (id) => {
      const externalId = store.externalIdOf(id);
      const stored = externalId === undefined ? undefined : store.cards.get(externalId);
      if (!stored) throw new StorageError('not_found', `unknown card ${id}`);
      return stored.lines.join('\n');
    },
    seed: {
      legacyCard: async () =>
        store.seed(store.nextExternalId(), { type: 'topic', title: 'Legacy topic', body: 'Old.' }),
      cardWithForeignFields: async () =>
        store.seed(store.nextExternalId(), {
          format: 2,
          'x-store-field': 'kept verbatim',
          type: 'claim',
          title: 'Original title',
          layer: 'said',
          originSystem: 'Fake store',
          author: 'human',
          'x-other': { nested: [1, 2] },
          body: 'Body.',
        }),
      believedCard: async () => {
        const note = 'I hold this, with doubts.';
        const id = store.seed(store.nextExternalId(), {
          type: 'claim',
          title: 'Believed legacy claim',
          [LEGACY_BELIEVED]: true,
          [LEGACY_ASSESSMENT]: note,
          originSystem: 'Fake store',
        });
        return { id, note };
      },
      assessmentOnlyCard: async () => {
        const note = 'Plausible, but the source has an interest.';
        const id = store.seed(store.nextExternalId(), {
          format: 2,
          type: 'claim',
          title: 'Assessed legacy claim',
          layer: 'said',
          author: 'human',
          originSystem: 'Fake store',
          [LEGACY_ASSESSMENT]: note,
        });
        return { id, note };
      },
    },
  };
}
