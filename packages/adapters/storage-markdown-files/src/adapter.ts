// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The reference StorageAdapter: a directory of Markdown cards with YAML front matter
// (ADR-0005, ADR-0006, ADR-0023, ADR-0027, ADR-0033, ADR-0034).
//
//   <root>/worldbuilder-store.yaml   store configuration with the random storeInstanceId
//   <root>/world.json | worlds/*.json   worlds (optional)
//   <root>/cards/**/*.md             one card per file
//   <root>/cards/**/_archive/<file>.v<n>.md   archived versions, never current cards
//   <root>/.worldbuilder/write.lock  the single-writer lock, held only while writing
//
// Files are the truth. The index (cards by id, search text, worlds) lives in memory, is
// rebuilt from the files at start, and is refreshed by a file watcher whose events are only
// hints: a changed file is re-read, and a full rescan repairs anything the watcher missed.

import { createHash, randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, encodeUlid } from '@worldbuilder/core';
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
  StorageAdapter,
  StorageCapabilities,
  World,
  WriteGuard,
} from '@worldbuilder/core';
import { parse as parseYaml } from 'yaml';
import {
  PATCHABLE_FIELDS,
  applyPatch,
  parseCardText,
  referencedIds,
  renderNewCard,
  type CodecContext,
} from './codec.js';
import { MarkdownStoreError } from './errors.js';
import { parseFrontMatter } from './frontmatter.js';
import { writeAtomic } from './atomic.js';
import { acquireLock, type LockOptions } from './lock.js';
import { describeErrors, schemaValidator } from './validate.js';
import { mintUlid } from './ulid.js';

/** `canonicalJson` that also accepts `undefined` (a field that is not there). */
const jsonOf = (v: unknown): string => (v === undefined ? 'undefined' : canonicalJson(v));

export const CONFIG_FILE = 'worldbuilder-store.yaml';
export const CARDS_DIR = 'cards';
export const ARCHIVE_DIR = '_archive';
export const LOCK_FILE = '.worldbuilder/write.lock';

/** A file modified this recently may share its timestamp with a later write: always re-read. */
const RACY_MS = 2000;
const DEFAULT_LIMIT = 50;
/** An unknown id triggers at most one rescan per this many milliseconds. */
const MISS_RESCAN_MS = 1000;
const STRUCTURED_TYPES: ReadonlySet<string> = new Set(['lage', 'rule', 'decision']);

export interface OpenOptions {
  /** Create the folder and a store configuration with a fresh storeInstanceId if missing. */
  readonly createIfMissing?: boolean;
  /** Watch the files for changes (default true). Without it, every query re-checks the files. */
  readonly watch?: boolean;
  /** Safety-net rescan interval while watching (default 60 s). */
  readonly rescanIntervalMs?: number;
  /** Delay between a watcher event and the refresh it triggers (default 30 ms). */
  readonly debounceMs?: number;
  readonly lock?: LockOptions;
}

/** Search over the canonical query, plus tags (all given tags must be on the card). */
export interface MarkdownSearchQuery extends CardSearchQuery {
  readonly tags?: readonly string[];
}

/** A file the index could not use, with the reason. */
export interface Diagnostic {
  readonly path: string;
  readonly message: string;
}

interface Entry {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly card: Card;
  readonly worldNames: readonly string[];
  /** Folded title (first line) and the rest, for search. */
  readonly title: string;
  readonly haystack: string;
}

interface ArchiveEntry {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly id: string;
  readonly version: number;
}

const validateCard = () => schemaValidator('card.schema.json');
const validateDraft = () => schemaValidator('card.schema.json#/$defs/draft');
const validateWorld = () => schemaValidator('world.schema.json');
const validateConfig = () => schemaValidator('store-config.schema.json');

/** Lower case, accents removed: the text a search compares. */
function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Deterministic id of a world that cards name but no world file defines ("created on demand"). */
function implicitWorldId(storeInstanceId: string, name: string): string {
  const bytes = createHash('sha256')
    .update(`wb-world:${storeInstanceId}/${name.normalize('NFC')}`)
    .digest();
  return encodeUlid(bytes.subarray(0, 16));
}

function slugOf(title: string): string {
  const slug = fold(title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug === '' ? 'card' : slug;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

export class MarkdownFilesAdapter implements StorageAdapter {
  readonly capabilities: StorageCapabilities = { write: true, search: true, ids: 'native' };

  private readonly cardsDir: string;
  private readonly lockPath: string;
  private readonly entries = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();
  private readonly archived = new Map<string, ArchiveEntry>();
  private readonly problems = new Map<string, string>();
  private explicitWorlds: World[] = [];
  private nameById = new Map<string, string>();
  private idByName = new Map<string, string>();
  private worldSignature = '';
  private syncChain: Promise<void> = Promise.resolve();
  private writeChain: Promise<unknown> = Promise.resolve();
  private dirty = true;
  private watching = false;
  private watchers: FSWatcher[] = [];
  private timers: NodeJS.Timeout[] = [];
  private closed = false;
  private lastMissRescan = 0;
  private readonly duplicates = new Map<string, string>();

  private readonly ctx: CodecContext;

  private constructor(
    private readonly root: string,
    readonly storeInstanceId: string,
    private readonly options: OpenOptions,
  ) {
    this.cardsDir = path.join(root, CARDS_DIR);
    this.lockPath = path.join(root, ...LOCK_FILE.split('/'));
    this.ctx = {
      storeInstanceId,
      worldId: (name) => this.idByName.get(name) ?? implicitWorldId(this.storeInstanceId, name),
      worldName: (id) => {
        const name = this.nameById.get(id);
        if (name === undefined) {
          throw new MarkdownStoreError('invalid_card', `unknown world ${id}`);
        }
        return name;
      },
    };
  }

  /** Open the store at `root`, build the index from its files and start watching them. */
  static async open(root: string, options: OpenOptions = {}): Promise<MarkdownFilesAdapter> {
    const abs = path.resolve(root);
    const configPath = path.join(abs, CONFIG_FILE);
    if (!(await exists(configPath))) {
      if (!options.createIfMissing) {
        throw new MarkdownStoreError('bad_store', `no ${CONFIG_FILE} in the store folder`);
      }
      await mkdir(path.join(abs, CARDS_DIR), { recursive: true });
      await writeFile(
        configPath,
        `# Store configuration (markdown-files format).\nstoreInstanceId: ${randomUUID()}\n`,
        'utf8',
      );
    }
    let config: unknown;
    try {
      config = parseYaml(await readFile(configPath, 'utf8'));
    } catch (err) {
      throw new MarkdownStoreError('bad_store', `${CONFIG_FILE} is not valid YAML: ${String(err)}`);
    }
    const validate = validateConfig();
    if (!validate(config)) {
      throw new MarkdownStoreError('bad_store', `${CONFIG_FILE}: ${describeErrors(validate)}`);
    }
    const adapter = new MarkdownFilesAdapter(
      abs,
      (config as { storeInstanceId: string }).storeInstanceId,
      options,
    );
    await adapter.sync(true);
    if (options.watch ?? true) adapter.startWatching();
    return adapter;
  }

  /** Stop watching. The adapter stays usable; it then checks the files on every query. */
  close(): void {
    this.closed = true;
    this.watching = false;
    for (const w of this.watchers) w.close();
    for (const t of this.timers) clearTimeout(t);
    this.watchers = [];
    this.timers = [];
  }

  /** Files the index could not use (malformed, invalid or duplicate cards). */
  diagnostics(): readonly Diagnostic[] {
    return [...this.problems, ...this.duplicates].map(([path, message]) => ({ path, message }));
  }

  /** Throw the index away and rebuild it from the files (ADR-0033). */
  async rebuildIndex(): Promise<void> {
    await this.sync(true);
  }

  // ------------------------------------------------------------------ reading

  async read(id: CardId): Promise<Card | undefined> {
    await this.ensureFresh();
    let entry = this.byId.get(id);
    if (!entry && this.watching && Date.now() - this.lastMissRescan > MISS_RESCAN_MS) {
      // Watcher events are hints: a miss falls back to a rescan, at most once per interval.
      // Without a watcher ensureFresh() has just rescanned.
      this.lastMissRescan = Date.now();
      await this.sync();
      entry = this.byId.get(id);
    }
    return entry ? structuredClone(entry.card) : undefined;
  }

  async list(query: CardListQuery = {}): Promise<Page<Card>> {
    await this.ensureFresh();
    const all = [...this.byId.values()]
      .filter((e) => !query.worldId || e.card.worlds?.includes(query.worldId))
      .sort((a, b) => (a.card.id < b.card.id ? -1 : 1));
    return this.page(all, query);
  }

  async search(query: MarkdownSearchQuery): Promise<Page<Card>> {
    await this.ensureFresh();
    const tokens = fold(query.text ?? '')
      .split(/\s+/)
      .filter((t) => t !== '');
    const wantTags = (query.tags ?? []).map(fold);
    const scored: { entry: Entry; score: number }[] = [];
    for (const entry of this.byId.values()) {
      const card = entry.card;
      if (query.worldId && !card.worlds?.includes(query.worldId)) continue;
      if (query.type && card.type !== query.type) continue;
      if (query.layer && card.layer !== query.layer) continue;
      if (wantTags.length > 0) {
        const have = (card.tags ?? []).map(fold);
        if (!wantTags.every((t) => have.includes(t))) continue;
      }
      if (!tokens.every((t) => entry.haystack.includes(t))) continue;
      scored.push({ entry, score: tokens.filter((t) => entry.title.includes(t)).length });
    }
    scored.sort((a, b) => b.score - a.score || (a.entry.card.id < b.entry.card.id ? -1 : 1));
    return this.page(
      scored.map((s) => s.entry),
      query,
    );
  }

  async listWorlds(): Promise<readonly World[]> {
    await this.ensureFresh();
    const known = new Set(this.explicitWorlds.map((w) => w.id));
    const implicit: World[] = [];
    for (const [id, name] of this.nameById) {
      if (!known.has(id)) implicit.push({ id, name });
    }
    implicit.sort((a, b) => a.name.localeCompare(b.name));
    return structuredClone([...this.explicitWorlds, ...implicit]);
  }

  async versions(id: CardId): Promise<readonly ArchivedVersion[]> {
    await this.ensureFresh();
    const files = [...this.archived.values()]
      .filter((a) => a.id === id)
      .sort((a, b) => a.version - b.version);
    const out: ArchivedVersion[] = [];
    for (const f of files) {
      try {
        const text = await readFile(this.abs(f.path), 'utf8');
        const { card } = parseCardText(text, this.ctx);
        out.push({
          version: f.version,
          archivedAt: new Date(f.mtimeMs).toISOString(),
          card,
        });
      } catch {
        // an unreadable archived file is skipped; it is reported by diagnostics()
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ writing

  async create(draft: CardDraft, author: KnownAuthor): Promise<CardId> {
    const validate = validateDraft();
    if (!validate(draft)) {
      throw new MarkdownStoreError(
        'invalid_card',
        `invalid card draft: ${describeErrors(validate)}`,
      );
    }
    return this.write(async () => {
      const id = mintUlid();
      const text = renderNewCard(id, draft, author, this.ctx);
      const { card } = this.parseForWrite(text);
      this.assertStored(card, draft as unknown as Record<string, unknown>);
      this.assertReferences(card as unknown as Record<string, unknown>);
      const rel = `${CARDS_DIR}/${slugOf(draft.title)}-${id.slice(-8).toLowerCase()}.md`;
      const abs = this.abs(rel);
      if (await exists(abs)) throw new MarkdownStoreError('conflict', `${rel} already exists`);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeAtomic(abs, text);
      await this.sync();
      return id;
    });
  }

  async patch(id: CardId, patch: CardPatch, guard: WriteGuard = {}): Promise<void> {
    const keys = Object.keys(patch);
    const bad = keys.filter((k) => !PATCHABLE_FIELDS.has(k));
    if (bad.length > 0) {
      throw new MarkdownStoreError(
        'invalid_patch',
        `not a patchable canonical card field: ${bad.join(', ')}`,
      );
    }
    const changes = patch as Record<string, unknown>;
    await this.write(async () => {
      const entry = this.byId.get(id);
      if (!entry) throw new MarkdownStoreError('not_found', `unknown card ${id}`);
      const abs = this.abs(entry.path);
      const text = await readFile(abs, 'utf8');
      const current = parseCardText(text, this.ctx).card;

      if (guard.contentHash !== undefined && guard.contentHash !== current.contentHash) {
        throw new MarkdownStoreError(
          'conflict',
          `content changed: stored ${current.contentHash}, expected ${guard.contentHash}`,
        );
      }
      const storedVersion = current.lage?.version;
      if (guard.lageVersion !== undefined && guard.lageVersion !== storedVersion) {
        throw new MarkdownStoreError(
          'conflict',
          `version conflict: stored ${String(storedVersion)}, expected ${guard.lageVersion}`,
        );
      }
      if (patch.lage) {
        if (current.type !== 'lage' || storedVersion === undefined) {
          throw new MarkdownStoreError(
            'invalid_patch',
            'only a card of type lage has a board state',
          );
        }
        if (patch.lage.version !== storedVersion + 1) {
          throw new MarkdownStoreError(
            'invalid_patch',
            'a new Lage version must be the stored version plus one',
          );
        }
      }
      this.assertReferences(changes);
      if (
        patch.type !== undefined &&
        patch.type !== current.type &&
        (STRUCTURED_TYPES.has(current.type) || STRUCTURED_TYPES.has(patch.type))
      ) {
        throw new MarkdownStoreError(
          'invalid_patch',
          'the type of a lage, rule or decision card cannot be changed',
        );
      }

      const next = applyPatch(text, changes, this.ctx);
      const { card } = this.parseForWrite(next);
      this.assertStored(card, changes, 'invalid_patch');
      // Structured content changes only through its own key (a Lage with a version bump and
      // an archived previous version), never as a side effect of a body patch.
      for (const key of ['lage', 'rule', 'sections'] as const) {
        if (!(key in changes) && jsonOf(card[key]) !== jsonOf(current[key])) {
          throw new MarkdownStoreError(
            'invalid_patch',
            `${key} can only be changed through the ${key} field, not through the body`,
          );
        }
      }
      if (next === text) return;
      if (patch.lage) await this.archiveCopy(entry.path, text, storedVersion);
      await writeAtomic(abs, next);
      await this.sync();
    });
  }

  async archive(id: CardId): Promise<void> {
    await this.write(async () => {
      const entry = this.byId.get(id);
      if (!entry) throw new MarkdownStoreError('not_found', `unknown card ${id}`);
      const abs = this.abs(entry.path);
      const text = await readFile(abs, 'utf8');
      const card = parseCardText(text, this.ctx).card;
      await this.archiveCopy(entry.path, text, card.lage?.version);
      await unlink(abs);
      await this.sync();
    });
  }

  // ------------------------------------------------------------------ internals

  private abs(rel: string): string {
    return path.join(this.root, ...rel.split('/'));
  }

  private page(entries: readonly Entry[], query: CardListQuery): Page<Card> {
    const start = query.cursor === undefined ? 0 : Number(query.cursor);
    if (!Number.isInteger(start) || start < 0) {
      throw new MarkdownStoreError('invalid_query', 'invalid cursor');
    }
    const limit = query.limit ?? DEFAULT_LIMIT;
    const items = entries.slice(start, start + limit).map((e) => structuredClone(e.card));
    return start + limit < entries.length
      ? { items, nextCursor: String(start + limit) }
      : { items };
  }

  /** Parse and validate the text of a card about to be written. */
  private parseForWrite(text: string): { card: Card } {
    let card: Card;
    try {
      card = parseCardText(text, this.ctx).card;
    } catch (err) {
      if (err instanceof MarkdownStoreError && err.code === 'parse') {
        throw new MarkdownStoreError('invalid_card', err.message);
      }
      throw err;
    }
    const validate = validateCard();
    if (!validate(card)) {
      throw new MarkdownStoreError('invalid_card', `invalid card: ${describeErrors(validate)}`);
    }
    return { card };
  }

  /** What was read back from the written text must equal what the caller gave. */
  private assertStored(
    card: Card,
    given: Record<string, unknown>,
    code: 'invalid_card' | 'invalid_patch' = 'invalid_card',
  ): void {
    const structured = ['lage', 'rule', 'sections'].some((k) => given[k] !== undefined);
    for (const [key, value] of Object.entries(given)) {
      if (value === undefined || key === 'contentHash' || key === 'format') continue;
      let stored: unknown = card[key as keyof Card];
      let wanted: unknown = value;
      if (key === 'body') {
        if (structured) continue; // the body also holds the rendered structure
        stored = String(stored).trimEnd();
        wanted = String(value).replace(/\r\n/g, '\n').trimEnd();
      }
      if (jsonOf(stored) !== jsonOf(wanted)) {
        throw new MarkdownStoreError(code, `the card cannot hold ${key} as given`);
      }
    }
  }

  /** Every card the written fields point to must exist in this store. */
  private assertReferences(content: Record<string, unknown>): void {
    const missing = referencedIds(content).filter((id) => !this.byId.has(id));
    if (missing.length > 0) {
      throw new MarkdownStoreError(
        'invalid_card',
        `references unknown cards: ${missing.join(', ')}`,
      );
    }
  }

  /** Keep `text` as `_archive/<file>.v<n>.md` next to the card; never overwrites a version. */
  private async archiveCopy(
    rel: string,
    text: string,
    preferred: number | undefined,
  ): Promise<void> {
    const abs = this.abs(rel);
    const dir = path.join(path.dirname(abs), ARCHIVE_DIR);
    const stem = path.basename(rel, '.md');
    await mkdir(dir, { recursive: true });
    const taken = (await readdir(dir).catch(() => [])).flatMap((name) => {
      const m = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v(\\d+)\\.md$`).exec(
        name,
      );
      return m ? [Number(m[1])] : [];
    });
    const n =
      preferred !== undefined && !taken.includes(preferred) ? preferred : Math.max(0, ...taken) + 1;
    await writeAtomic(path.join(dir, `${stem}.v${n}.md`), text);
  }

  /** Serialise writes in this process, then across processes with the lock file. */
  private write<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(async () => {
      const held = await acquireLock(this.lockPath, this.options.lock);
      try {
        await this.sync(); // see what other writers did before deciding anything
        return await fn();
      } finally {
        await held.release();
      }
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private async ensureFresh(): Promise<void> {
    if (!this.watching || this.dirty) await this.sync();
  }

  private startWatching(): void {
    const hint = () => {
      this.dirty = true;
      if (this.closed || this.debounce) return;
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        this.sync().catch(() => undefined);
      }, this.options.debounceMs ?? 30);
      this.debounce.unref();
      this.timers.push(this.debounce);
    };
    try {
      const onError = () => {
        // Platforms differ in what they report: without a working watcher, check on every query.
        this.watching = false;
      };
      const cards = watch(this.cardsDir, { recursive: true, persistent: false }, hint);
      const rootDir = watch(this.root, { persistent: false }, (_e, name) => {
        if (name && (name.startsWith('world') || name === CONFIG_FILE)) hint();
      });
      cards.on('error', onError);
      rootDir.on('error', onError);
      this.watchers.push(cards, rootDir);
      this.watching = true;
      const timer = setInterval(() => {
        this.dirty = true;
      }, this.options.rescanIntervalMs ?? 60_000);
      timer.unref();
      this.timers.push(timer);
    } catch {
      this.watching = false;
    }
  }

  private debounce: NodeJS.Timeout | undefined;

  /** Bring the index in line with the files. `full` re-reads every file. */
  private sync(full = false): Promise<void> {
    const run = this.syncChain.then(() => this.doSync(full));
    this.syncChain = run.catch(() => undefined);
    return run;
  }

  private async doSync(full: boolean): Promise<void> {
    this.dirty = false;
    const worldsChanged = await this.loadWorlds();
    const force = full || worldsChanged;
    if (force) {
      this.entries.clear();
      this.archived.clear();
      for (const key of [...this.problems.keys()]) {
        if (key.startsWith(`${CARDS_DIR}/`)) this.problems.delete(key);
      }
    }

    const live: string[] = [];
    const arch: string[] = [];
    await this.walk(this.cardsDir, CARDS_DIR, false, live, arch);

    const seen = new Set<string>();
    for (const rel of live) {
      seen.add(rel);
      await this.syncCard(rel);
    }
    for (const rel of [...this.entries.keys()]) if (!seen.has(rel)) this.entries.delete(rel);
    for (const rel of [...this.problems.keys()]) {
      if (rel.startsWith(`${CARDS_DIR}/`) && !seen.has(rel) && !arch.includes(rel)) {
        this.problems.delete(rel);
      }
    }

    const seenArchive = new Set<string>();
    for (const rel of arch) {
      seenArchive.add(rel);
      await this.syncArchive(rel);
    }
    for (const rel of [...this.archived.keys()]) {
      if (!seenArchive.has(rel)) this.archived.delete(rel);
    }

    // An id found in more than one file is ambiguous: none of its files is indexed or written.
    const byIdAll = new Map<string, Entry[]>();
    for (const entry of this.entries.values()) {
      byIdAll.set(entry.card.id, [...(byIdAll.get(entry.card.id) ?? []), entry]);
    }
    this.byId.clear();
    this.duplicates.clear();
    for (const [id, group] of byIdAll) {
      if (group.length === 1) {
        this.byId.set(id, group[0]!);
        continue;
      }
      const paths = group.map((e) => e.path).sort();
      for (const p of paths) {
        this.duplicates.set(p, `duplicate id ${id} in ${paths.join(', ')}; none of them is used`);
      }
    }
    this.rebuildWorldNames();
  }

  /** Collect card files; `_archive` folders are kept apart from current cards. */
  private async walk(
    dir: string,
    rel: string,
    inArchive: boolean,
    live: string[],
    arch: string[],
  ): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      if (item.name.startsWith('.')) continue; // temporary files, editor droppings
      const childRel = `${rel}/${item.name}`;
      if (item.isDirectory()) {
        await this.walk(
          path.join(dir, item.name),
          childRel,
          inArchive || item.name === ARCHIVE_DIR,
          live,
          arch,
        );
      } else if (item.isFile() && item.name.endsWith('.md')) {
        (inArchive ? arch : live).push(childRel);
      } // symbolic links are never followed out of the store
    }
  }

  private async syncCard(rel: string): Promise<void> {
    const abs = this.abs(rel);
    const st = await stat(abs).catch(() => undefined);
    if (!st) return;
    const old = this.entries.get(rel);
    if (
      old &&
      old.mtimeMs === st.mtimeMs &&
      old.size === st.size &&
      Date.now() - st.mtimeMs > RACY_MS
    ) {
      return;
    }
    try {
      const text = await readFile(abs, 'utf8');
      const { card, worldNames } = parseCardText(text, this.ctx);
      const validate = validateCard();
      if (!validate(card)) throw new Error(describeErrors(validate));
      this.problems.delete(rel);
      const title = fold(card.title);
      this.entries.set(rel, {
        path: rel,
        mtimeMs: st.mtimeMs,
        size: st.size,
        card,
        worldNames,
        title,
        haystack: fold(`${card.title}\n${card.body ?? ''}\n${(card.tags ?? []).join(' ')}`),
      });
    } catch (err) {
      this.entries.delete(rel);
      this.problems.set(rel, err instanceof Error ? err.message : String(err));
    }
  }

  private async syncArchive(rel: string): Promise<void> {
    const abs = this.abs(rel);
    const st = await stat(abs).catch(() => undefined);
    if (!st) return;
    const old = this.archived.get(rel);
    if (old && old.mtimeMs === st.mtimeMs && old.size === st.size) return;
    const m = /\.v(\d+)\.md$/.exec(rel);
    try {
      const id = parseFrontMatter(await readFile(abs, 'utf8')).data['id'];
      if (!m || typeof id !== 'string') throw new Error('not an archived card version');
      this.archived.set(rel, {
        path: rel,
        mtimeMs: st.mtimeMs,
        size: st.size,
        id,
        version: Number(m[1]),
      });
    } catch (err) {
      this.archived.delete(rel);
      this.problems.set(rel, err instanceof Error ? err.message : String(err));
    }
  }

  /** Read `world.json` and `worlds/*.json`. Returns true if the set of worlds changed. */
  private async loadWorlds(): Promise<boolean> {
    const files = ['world.json'];
    const dir = path.join(this.root, 'worlds');
    for (const name of (await readdir(dir).catch(() => [])).sort()) {
      if (name.endsWith('.json') && !name.startsWith('.')) files.push(`worlds/${name}`);
    }
    const stats: string[] = [];
    for (const f of files) {
      const st = await stat(this.abs(f)).catch(() => undefined);
      if (st) stats.push(`${f}:${st.mtimeMs}:${st.size}`);
    }
    const signature = stats.join('|');
    if (signature === this.worldSignature) return false;
    this.worldSignature = signature;

    const worlds: World[] = [];
    const validate = validateWorld();
    for (const f of files) {
      const text = await readFile(this.abs(f), 'utf8').catch(() => undefined);
      if (text === undefined) continue;
      try {
        const json = JSON.parse(text) as { data?: unknown };
        const world = json.data !== undefined && 'schema' in json ? json.data : json;
        if (!validate(world)) throw new Error(describeErrors(validate));
        worlds.push(world as World);
        this.problems.delete(f);
      } catch (err) {
        this.problems.set(f, err instanceof Error ? err.message : String(err));
      }
    }
    this.explicitWorlds = worlds;
    this.idByName = new Map(worlds.map((w) => [w.name, w.id]));
    this.rebuildWorldNames();
    return true;
  }

  /** Names for explicit worlds plus the worlds that cards name without a world file. */
  private rebuildWorldNames(): void {
    const names = new Map(this.explicitWorlds.map((w) => [w.id, w.name]));
    for (const entry of this.byId.values()) {
      for (const name of entry.worldNames) {
        names.set(this.ctx.worldId(name), name);
      }
    }
    this.nameById = names;
  }
}
