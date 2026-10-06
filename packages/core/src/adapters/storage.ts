// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  Card,
  CardContent,
  CardDraft,
  CardId,
  KnownAuthor,
  Layer,
  Stance,
  World,
  WorldId,
} from '../generated/contracts.js';

/** What a backend supports. The board hides what an adapter cannot do. */
export interface StorageCapabilities {
  /** Cards can be created and patched (false for read-only stores). */
  readonly write: boolean;
  /** Full-text search over title and body. */
  readonly search: boolean;
  /**
   * `native`: the store keeps the canonical ULID in its own id field (markdown-files).
   * `derived`: the canonical id is derived from the card URI (ADR-0023).
   */
  readonly ids: 'native' | 'derived';
}

/** One page of results. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface CardListQuery {
  readonly worldId?: WorldId;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface CardSearchQuery extends CardListQuery {
  readonly text?: string;
  readonly type?: string;
  readonly layer?: Layer;
}

/**
 * The canonical fields a product change may set. Identity, format and the computed hash are
 * never patched; stance data is not a card field and can never be written (ADR-0008).
 */
export type CardPatch = Partial<
  Omit<CardContent, 'id' | 'externalId' | 'uri' | 'format' | 'contentHash' | 'level' | 'signature'>
>;

/** Optimistic concurrency guard for a write (ADR-0006). */
export interface WriteGuard {
  readonly contentHash?: string;
  /** For Lage cards: the stored board-state version. */
  readonly lageVersion?: number;
}

/** A previous version of a card, kept in the store's archive (ADR-0006). */
export interface ArchivedVersion {
  readonly version: number;
  readonly archivedAt: string;
  readonly card: Card;
}

/**
 * One backend that holds cards, worlds, Lagen and decisions (ADR-0005). Adapters write only
 * through the backend's own write path and validator, and every write is a patch: store
 * content the product does not own stays verbatim (ADR-0023). Every adapter must pass
 * `describeStorageAdapterConformance` from `@worldbuilder/conformance`.
 */
export interface StorageAdapter {
  /** Random UUID of this store; part of every card URI. Never a hostname, path or name. */
  readonly storeInstanceId: string;
  readonly capabilities: StorageCapabilities;

  /** Read one card by canonical id; `undefined` if it does not exist. */
  read(id: CardId): Promise<Card | undefined>;
  list(query?: CardListQuery): Promise<Page<Card>>;
  search(query: CardSearchQuery): Promise<Page<Card>>;
  listWorlds(): Promise<readonly World[]>;

  /**
   * Create a card and return its canonical id: minted, or derived from the store-assigned id.
   * Callers use the returned id and never predict it. `author` comes from the caller's
   * identity (a human, or the agent whose accepted proposal this is), never from the draft.
   */
  create(draft: CardDraft, author: KnownAuthor): Promise<CardId>;
  /**
   * Change only the given canonical fields. The stored file stays byte-identical except for
   * these fields. Rejects unknown fields, stance data and identity changes. A rewrite of a
   * versioned card (a Lage) archives the previous version.
   */
  patch(id: CardId, patch: CardPatch, guard?: WriteGuard): Promise<void>;
  /** Retire a card: its current version moves to the archive; nothing is deleted. */
  archive(id: CardId): Promise<void>;
  /** Archived versions of a card, oldest first. */
  versions(id: CardId): Promise<readonly ArchivedVersion[]>;

  /**
   * Stance data the store already holds in legacy fields (for example a believed layer or an
   * own-assessment field), mapped per ADR-0008 and ADR-0023. Read only: the product keeps
   * stances on the device and never writes them through an adapter.
   */
  readLegacyStance?(id: CardId): Promise<Stance | undefined>;
}
