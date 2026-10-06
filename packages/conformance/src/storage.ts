// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Conformance kit for StorageAdapter implementations (ADR-0005, ADR-0006, ADR-0008, ADR-0023).
// Every adapter (the in-repo markdown-files adapter, the owner store's adapter, third-party
// adapters) runs this suite in its own tests:
//
//   describeStorageAdapterConformance('my adapter', async () => ({ adapter, reopen, raw, seed }));

import type { CardDraft, CardId, StorageAdapter } from '@worldbuilder/core';
import { computeContentHash, deriveCardId, isWbUri, parseUri } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';

/** Direct access to the backend that the kit needs to check what was written. */
export interface StorageAdapterHarness {
  readonly adapter: StorageAdapter;
  /** A second adapter instance over the same store, as another process or machine sees it. */
  reopen(): Promise<StorageAdapter>;
  /** The stored text of a card exactly as the backend keeps it (the file for file stores). */
  raw(id: CardId): Promise<string>;
  /** Store content written behind the adapter's back, as other tools would. */
  readonly seed: {
    /** A legacy format-1 card: no layer, no author, no format-2 field. */
    legacyCard(): Promise<CardId>;
    /** A format-2 card that also holds store fields the product does not know. */
    cardWithForeignFields(): Promise<CardId>;
    /**
     * Optional: a card the store marks as believed, with an own assessment. Returns the
     * assessment text. Adapters of stores without such fields omit it.
     */
    believedCard?(): Promise<{ id: CardId; note: string }>;
  };
  /** How the raw text names a canonical field (default: the same name). */
  rawFieldName?(field: string): string;
}

export type StorageAdapterFactory = () => Promise<StorageAdapterHarness>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const draft: CardDraft = {
  format: 2,
  collection: 'evidence',
  type: 'claim',
  title: 'Conformance claim',
  layer: 'said',
  source: 'https://example.org/conformance',
  body: 'Synthetic conformance card.',
};

/** Lines that differ between two texts of the same length. */
function changedLines(before: string, after: string): { before: string[]; after: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length, 'a patch must not add or remove lines').toBe(a.length);
  const changed = a.map((_, i) => i).filter((i) => a[i] !== b[i]);
  return { before: changed.map((i) => a[i] ?? ''), after: changed.map((i) => b[i] ?? '') };
}

export function describeStorageAdapterConformance(
  name: string,
  factory: StorageAdapterFactory,
): void {
  describe(`StorageAdapter conformance: ${name}`, () => {
    it('exposes the contract shape and a UUID store instance id', async () => {
      const { adapter } = await factory();
      expect(adapter.storeInstanceId).toMatch(UUID_RE);
      expect(['native', 'derived']).toContain(adapter.capabilities.ids);
      for (const method of [
        'read',
        'list',
        'search',
        'listWorlds',
        'create',
        'patch',
        'archive',
        'versions',
      ]) {
        expect(typeof (adapter as unknown as Record<string, unknown>)[method], method).toBe(
          'function',
        );
      }
      const proto = Object.getPrototypeOf(adapter) as object | null;
      const methods = [
        ...(proto ? Object.getOwnPropertyNames(proto) : []),
        ...Object.keys(adapter),
      ];
      // No method may write stances (ADR-0008); reading legacy stance fields is allowed.
      expect(methods.filter((m) => /^stance|Stance/.test(m) && m !== 'readLegacyStance')).toEqual(
        [],
      );
    });

    it('create returns the canonical id, and re-reading yields the same id', async () => {
      const { adapter } = await factory();
      const id = await adapter.create(draft, 'human');
      const card = await adapter.read(id);
      expect(card?.id).toBe(id);
      expect(card?.format).toBe(2);
      expect(card?.author).toBe('human');
      expect(card?.title).toBe(draft.title);
      expect(id).toMatch(ULID_RE);
      if (adapter.capabilities.ids === 'derived') expect(id).toBe(deriveCardId(card?.uri ?? ''));
    });

    it('keeps the author of an accepted agent proposal', async () => {
      const { adapter } = await factory();
      const id = await adapter.create(draft, 'agent:conformance-helper');
      expect((await adapter.read(id))?.author).toBe('agent:conformance-helper');
    });

    it('yields the same id for the same card in another adapter instance', async () => {
      const { adapter, reopen, seed } = await factory();
      const created = await adapter.create(draft, 'human');
      const legacy = await seed.legacyCard();
      const other = await reopen();
      for (const id of [created, legacy]) {
        const a = await adapter.read(id);
        const b = await other.read(id);
        expect(b?.id).toBe(id);
        expect(b?.uri).toBe(a?.uri);
      }
      const ids = async (s: StorageAdapter) => (await s.list()).items.map((c) => c.id).sort();
      expect(await ids(other)).toEqual(await ids(adapter));
    });

    it('builds every uri from the store instance id, never from a hostname or path', async () => {
      const { adapter, seed } = await factory();
      await adapter.create(draft, 'human');
      await seed.legacyCard();
      await seed.cardWithForeignFields();
      const { items } = await adapter.list();
      expect(items.length).toBeGreaterThanOrEqual(3);
      for (const card of items) {
        expect(isWbUri(card.uri), card.uri).toBe(true);
        const parsed = parseUri(card.uri);
        expect(parsed.storeInstanceId).toBe(adapter.storeInstanceId);
        expect(parsed.externalId).toBe(card.externalId);
        if (adapter.capabilities.ids === 'derived') expect(card.id).toBe(deriveCardId(card.uri));
        else expect(card.externalId).toBe(card.id);
      }
    });

    it('returns every card with its content hash, stable across instances (ADR-0034)', async () => {
      const { adapter, reopen, seed } = await factory();
      const id = await seed.cardWithForeignFields();
      const card = await adapter.read(id);
      expect(card?.contentHash).toBe(computeContentHash(card!));
      expect((await (await reopen()).read(id))?.contentHash).toBe(card?.contentHash);
      await adapter.patch(id, { title: 'Hash changes' });
      const patched = await adapter.read(id);
      expect(patched?.contentHash).toBe(computeContentHash(patched!));
      expect(patched?.contentHash).not.toBe(card?.contentHash);
    });

    it('patches one field and leaves every other byte of the stored card unchanged', async () => {
      const harness = await factory();
      const { adapter, raw, seed } = harness;
      const field = harness.rawFieldName?.('title') ?? 'title';
      const id = await seed.cardWithForeignFields();
      const before = await raw(id);
      await adapter.patch(id, { title: 'Patched title' });
      const after = await raw(id);
      const diff = changedLines(before, after);
      expect(diff.before).toHaveLength(1);
      expect(diff.before[0]?.startsWith(`${field}:`)).toBe(true);
      expect(diff.after[0]?.startsWith(`${field}:`)).toBe(true);
      expect((await adapter.read(id))?.title).toBe('Patched title');
    });

    it('never writes stance data into a card', async () => {
      const { adapter, raw, seed } = await factory();
      const id = await seed.cardWithForeignFields();
      const before = await raw(id);
      const stance = { stance: { position: 'believed', weight: 3 } };
      await expect(adapter.patch(id, stance as never)).rejects.toThrow();
      await expect(adapter.patch(id, { position: 'believed' } as never)).rejects.toThrow();
      expect(await raw(id)).toBe(before);
    });

    it('refuses identity and format changes', async () => {
      const { adapter, raw, seed } = await factory();
      const id = await seed.cardWithForeignFields();
      const before = await raw(id);
      for (const patch of [
        { id: '01M1E34QM03WVTE8T1RYS3AM18' },
        { uri: 'wb:x/y' },
        { format: 1 },
      ]) {
        await expect(adapter.patch(id, patch as never)).rejects.toThrow();
      }
      expect(await raw(id)).toBe(before);
    });

    it('reads legacy cards with the legacy defaults', async () => {
      const { adapter, seed } = await factory();
      const card = await adapter.read(await seed.legacyCard());
      expect(card?.format).toBe(1);
      expect(card?.author).toBe('unknown');
      expect(card).not.toHaveProperty('layer');
      expect(card?.training ?? false).toBe(false);
    });

    it('maps a believed legacy card to said + a believed stance, read only', async (ctx) => {
      const { adapter, raw, seed } = await factory();
      if (!seed.believedCard) {
        ctx.skip();
        return;
      }
      const { id, note } = await seed.believedCard();
      const before = await raw(id);
      const card = await adapter.read(id);
      expect(card?.layer).toBe('said');
      expect(card?.author).toBe('human');
      const stance = await adapter.readLegacyStance?.(id);
      expect(stance?.position).toBe('believed');
      expect(stance?.note).toBe(note);
      expect(card).not.toHaveProperty('stance');
      expect(await raw(id)).toBe(before);
    });

    it('archives instead of deleting', async () => {
      const { adapter } = await factory();
      const id = await adapter.create(draft, 'human');
      await adapter.archive(id);
      expect(await adapter.read(id)).toBeUndefined();
      const versions = await adapter.versions(id);
      expect(versions.at(-1)?.card.id).toBe(id);
    });

    it('archives the previous Lage version on rewrite and guards the version', async () => {
      const { adapter } = await factory();
      const lage = {
        question: 'Conformance?',
        options: ['yes', 'no'],
        cards: [],
        seats: [{ name: 'Tester', kind: 'human' as const }],
        edges: [],
        version: 1,
        updatedAt: '2026-10-06T00:00:00Z',
      };
      const id = await adapter.create(
        { format: 2, collection: 'decisions', type: 'lage', title: 'Conformance Lage', lage },
        'human',
      );
      await adapter.patch(id, { lage: { ...lage, version: 2 } }, { lageVersion: 1 });
      expect((await adapter.read(id))?.lage?.version).toBe(2);
      expect((await adapter.versions(id)).map((v) => v.card.lage?.version)).toEqual([1]);
      await expect(
        adapter.patch(id, { lage: { ...lage, version: 3 } }, { lageVersion: 1 }),
      ).rejects.toThrow();
    });

    it('searches by text and filters by layer', async () => {
      const { adapter } = await factory();
      await adapter.create({ ...draft, title: 'Needle in the store' }, 'human');
      const hits = await adapter.search({ text: 'needle' });
      expect(hits.items.map((c) => c.title)).toContain('Needle in the store');
      const evidenced = await adapter.search({ text: 'needle', layer: 'evidenced' });
      expect(evidenced.items).toEqual([]);
    });
  });
}
