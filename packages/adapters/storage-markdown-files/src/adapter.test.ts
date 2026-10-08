// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { CardDraft } from '@worldbuilder/core';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownFilesAdapter } from './adapter.js';
import { MarkdownStoreError } from './errors.js';
import { acquireLock } from './lock.js';
import {
  cleanupAfterAll,
  copyHormuz,
  newId,
  openStore,
  tempDir,
  writeCardFile,
} from './testing/store.js';

cleanupAfterAll();

const WIRE = '01M1E34QM03WVTE8T1RYS3AM18';
const NAVY = '01M1EDEAG082WZ7T7D204BHZDC';
const LAGE = '01M1F21G80R816A1T0V2P6RACH';
const WORLD = '01M1DZPW00JGXPRPG4179ZPNB8';

const claim = (extra: object = {}): CardDraft =>
  ({
    format: 2,
    collection: 'evidence',
    type: 'claim',
    title: 'A new claim',
    layer: 'said',
    source: 'https://example.org/claim',
    ...extra,
  }) as CardDraft;

const fileOf = async (dir: string, id: string): Promise<string> => {
  for (const name of await readdir(path.join(dir, 'cards'))) {
    const p = path.join(dir, 'cards', name);
    if (name.endsWith('.md') && (await readFile(p, 'utf8')).includes(`id: ${id}`)) return p;
  }
  throw new Error(`no file for ${id}`);
};

const rejects = async (p: Promise<unknown>, code: MarkdownStoreError['reason']) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MarkdownStoreError);
  expect((err as MarkdownStoreError).reason).toBe(code);
};

describe('opening a store', () => {
  it('needs a configuration, unless asked to create one', async () => {
    const dir = await tempDir();
    await rejects(MarkdownFilesAdapter.open(dir), 'bad_store');
    const created = await openStore(dir, { createIfMissing: true });
    expect(created.storeInstanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readFile(path.join(dir, 'worldbuilder-store.yaml'), 'utf8')).toContain(
      created.storeInstanceId,
    );
    // reopening keeps the identity
    expect((await openStore(dir)).storeInstanceId).toBe(created.storeInstanceId);
  });

  it('rejects an invalid configuration', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'worldbuilder-store.yaml'), 'storeInstanceId: not-a-uuid\n');
    await rejects(MarkdownFilesAdapter.open(dir), 'bad_store');
    await writeFile(path.join(dir, 'worldbuilder-store.yaml'), 'a: [unclosed\n');
    await rejects(MarkdownFilesAdapter.open(dir), 'bad_store');
  });

  it('works on an empty store without a cards folder', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'worldbuilder-store.yaml'),
      'storeInstanceId: 45aaff12-777f-40e3-a97c-8a592e1ea4f6\n',
    );
    const adapter = await openStore(dir);
    expect((await adapter.list()).items).toEqual([]);
    expect(await adapter.listWorlds()).toEqual([]);
    const id = await adapter.create(claim(), 'human');
    expect((await adapter.read(id))?.title).toBe('A new claim');
  });
});

describe('create', () => {
  it('writes an LF file named after the title, with the minted id, and no stance data', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const id = await adapter.create(
      claim({ worlds: [WORLD], title: 'Ünïcode: Tïtle / with*odd?chars' }),
      'agent:scout',
    );
    const file = await fileOf(dir, id);
    expect(path.basename(file)).toMatch(/^unicode-title-with-odd-chars-[0-9a-z]{8}\.md$/);
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain('\r');
    expect(text).toContain('author: agent:scout');
    expect(text).toContain('worlds: [Hormuz]');
    expect(text).not.toMatch(/stance|position:|weight/);
    const card = await adapter.read(id);
    expect(card?.author).toBe('agent:scout');
    expect(card?.worlds).toEqual([WORLD]);
  });

  it('names the file "card" when the title has no usable characters', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    const id = await adapter.create(claim({ title: '***' }), 'human');
    expect(path.basename(await fileOf(dir, id))).toMatch(/^card-/);
  });

  it('refuses unknown worlds and dangling references, and writes nothing', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    await rejects(
      adapter.create(claim({ worlds: ['01M1DZPW00JGXPRPG4179ZPNB9'] }), 'human'),
      'invalid_card',
    );
    await rejects(
      adapter.create(claim({ edges: [{ target: WIRE, kind: 'supports', by: 'human' }] }), 'human'),
      'invalid_card',
    );
    expect(await readdir(path.join(dir, 'cards'))).toEqual([]);
  });

  it('accepts an edge to an existing card and a player field sourced by a card', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const id = await adapter.create(
      claim({
        collection: 'actors',
        type: 'organisation',
        edges: [{ target: WIRE, kind: 'cites', by: 'human' }],
        interests: [{ text: 'Keep the lane open', source: WIRE }],
      }),
      'human',
    );
    const card = await adapter.read(id);
    expect(card?.edges).toEqual([{ target: WIRE, kind: 'cites', by: 'human' }]);
    expect(card?.interests?.[0]?.source).toBe(WIRE);
  });

  it('creates a Lage and returns an id whose Position block reads back', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const lage = {
      question: 'Go?',
      options: ['yes', 'no'],
      cards: [{ id: WIRE, x: 1, y: 2 }],
      seats: [{ name: 'Me', kind: 'human' as const }],
      edges: [],
      version: 1,
      updatedAt: '2026-10-06T00:00:00Z',
    };
    const id = await adapter.create(
      { format: 2, collection: 'decisions', type: 'lage', title: 'New Lage', lage } as CardDraft,
      'human',
    );
    expect((await adapter.read(id))?.lage).toEqual(lage);
    await rejects(
      adapter.create(
        {
          format: 2,
          type: 'lage',
          title: 'Bad',
          lage: { ...lage, cards: [{ id: newId(), x: 0, y: 0 }] },
        } as CardDraft,
        'human',
      ),
      'invalid_card',
    );
  });
});

describe('patch', () => {
  it('aborts without writing when the store lock was taken over before the rename', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const file = await fileOf(dir, WIRE);
    const before = await readFile(file, 'utf8');
    const sync = (adapter as unknown as { sync: () => Promise<void> }).sync.bind(adapter);
    // Simulate a stale-lock breaker replacing the lock after we acquired it.
    vi.spyOn(adapter as unknown as { sync: () => Promise<void> }, 'sync').mockImplementationOnce(
      async () => {
        await writeFile(
          path.join(dir, '.worldbuilder', 'write.lock'),
          JSON.stringify({ token: 'thief', pid: process.pid, host: 'x', createdAt: Date.now() }),
        );
        await sync();
      },
    );
    await rejects(adapter.patch(WIRE, { title: 'Should not land' }), 'locked');
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('keeps comments, order, foreign fields and quoting while changing several fields', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    const id = newId();
    const original = [
      '---',
      '# a comment',
      `id: ${id}`,
      'format: 2',
      "x-store-field:   'kept   verbatim'",
      'type: claim',
      'title:    Original title   # trailing comment',
      'layer: said',
      'originSystem: Example store',
      'author: human',
      'tags: [a, b]',
      'x-other:',
      '  nested: [1, 2]',
      '---',
      '',
      'Body.',
      '',
    ].join('\n');
    await writeCardFile(dir, 'foreign.md', original);
    await adapter.patch(id, { title: 'Changed', tags: ['c'], status: 'checked' });
    const text = await readFile(path.join(dir, 'cards', 'foreign.md'), 'utf8');
    expect(text).toBe(
      original
        .replace('title:    Original title', 'title: Changed')
        .replace('tags: [a, b]', 'tags: [c]')
        .replace('x-other:', 'x-other:')
        .replace('  nested: [1, 2]\n---', '  nested: [1, 2]\nstatus: checked\n---'),
    );
  });

  it('removes a field when the patch value is undefined', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    await adapter.patch(WIRE, { tags: undefined, class: undefined });
    const card = await adapter.read(WIRE);
    expect(card).not.toHaveProperty('tags');
    expect(card).not.toHaveProperty('class');
    expect(await readFile(await fileOf(dir, WIRE), 'utf8')).not.toContain('tags:');
  });

  it('preserves CRLF files and writes the changed field with CRLF', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    const id = newId();
    const crlf = `---\r\nid: ${id}\r\ntype: topic\r\ntitle: Old\r\n---\r\n\r\nBody\r\n`;
    await writeCardFile(dir, 'crlf.md', crlf);
    await adapter.patch(id, { title: 'New', status: 'draft' });
    expect(await readFile(path.join(dir, 'cards', 'crlf.md'), 'utf8')).toBe(
      `---\r\nid: ${id}\r\ntype: topic\r\ntitle: New\r\nstatus: draft\r\n---\r\n\r\nBody\r\n`,
    );
    expect((await adapter.read(id))?.body).toBe('Body\n');
  });

  it('does not touch the file when nothing changes', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const file = await fileOf(dir, WIRE);
    const old = new Date('2020-01-01T00:00:00Z');
    await utimes(file, old, old);
    await adapter.patch(WIRE, { title: (await adapter.read(WIRE))!.title });
    expect((await stat(file)).mtime.getTime()).toBe(old.getTime());
  });

  it('refuses unknown fields, stance data, reserved and identity fields', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const before = await readFile(await fileOf(dir, WIRE), 'utf8');
    for (const patch of [
      { stance: { position: 'believed' } },
      { position: 'believed' },
      { weight: 3 },
      { level: 2 },
      { signature: 'x' },
      { id: newId() },
      { author: 'human' },
      { contentHash: 'sha256:' + '0'.repeat(64) },
      { 'x-foreign': 1 },
    ]) {
      await rejects(adapter.patch(WIRE, patch as never), 'invalid_patch');
    }
    expect(await readFile(await fileOf(dir, WIRE), 'utf8')).toBe(before);
  });

  it('refuses a result that is not a valid card, and one the file cannot hold', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const before = await readFile(await fileOf(dir, WIRE), 'utf8');
    await rejects(adapter.patch(WIRE, { layer: 'evidenced', source: undefined }), 'invalid_card');
    await rejects(adapter.patch(WIRE, { layer: 'unknown' } as never), 'invalid_card');
    await rejects(
      adapter.patch(WIRE, { edges: [{ target: newId(), kind: 'supports', by: 'human' }] }),
      'invalid_card',
    );
    await rejects(
      adapter.patch(NAVY, { interests: [{ text: 'With, comma', source: WIRE }] }),
      'invalid_card',
    );
    // a board state cannot be put on a claim
    await rejects(
      adapter.patch(WIRE, {
        lage: {
          question: 'Q',
          options: [],
          cards: [],
          seats: [],
          edges: [],
          version: 1,
          updatedAt: '2026-01-01',
        },
      }),
      'invalid_patch',
    );
    // the body of a Lage cannot lose its Position block
    await rejects(adapter.patch(LAGE, { body: 'nothing' }), 'invalid_card');
    expect(await readFile(await fileOf(dir, WIRE), 'utf8')).toBe(before);
  });

  it('applies the guards', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const card = (await adapter.read(WIRE))!;
    await rejects(
      adapter.patch(WIRE, { title: 'X' }, { contentHash: 'sha256:' + '0'.repeat(64) }),
      'conflict',
    );
    await adapter.patch(WIRE, { title: 'Guarded' }, { contentHash: card.contentHash });
    await rejects(adapter.patch(WIRE, { title: 'Y' }, { lageVersion: 1 }), 'conflict');
    await rejects(adapter.patch(newId(), { title: 'Z' }), 'not_found');
    await rejects(
      adapter.patch(LAGE, {
        lage: { ...(await adapter.read(LAGE))!.lage!, version: 9 },
      }),
      'invalid_patch',
    );
  });

  it('serialises concurrent patches of one card: each applies on top of the previous one', async () => {
    const dir = await copyHormuz();
    const a = await openStore(dir);
    const b = await openStore(dir);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).patch(WIRE, { tags: [`t${i}`] })),
    );
    const tags = (await a.read(WIRE))!.tags!;
    expect(tags).toHaveLength(1);
    expect((await b.read(WIRE))!.tags).toEqual(tags);
  });
});

describe('structured cards', () => {
  const RULE = '01M1EV5S00YXKKGEG772AZM7P9';
  const DECISION = '01M1F5FBW0DPQND9KSXC12WHJW';

  it('refuses a type change on a Lage, a rule and a decision, and changes nothing', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    for (const id of [LAGE, RULE, DECISION]) {
      const before = await readFile(await fileOf(dir, id), 'utf8');
      await rejects(adapter.patch(id, { type: 'claim' }), 'invalid_patch');
      expect(await readFile(await fileOf(dir, id), 'utf8')).toBe(before);
    }
    await rejects(adapter.patch(WIRE, { type: 'lage' }), 'invalid_patch');
  });

  it('refuses a body patch that alters the Lage, the rule or the decision sections', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    for (const id of [LAGE, RULE, DECISION]) {
      const card = (await adapter.read(id))!;
      const before = await readFile(await fileOf(dir, id), 'utf8');
      const edited = card
        .body!.replace('"x": 120', '"x": 999')
        .replace('"then": "Reroute laden tankers via the Cape of Good Hope"', '"then": "Hold"')
        .replace('Delivery reliability before freight cost.', 'Cost before reliability.')
        .replace('Reroute laden tankers', 'Reroute laden tankers');
      expect(edited).not.toBe(card.body);
      await rejects(adapter.patch(id, { body: edited }), 'invalid_patch');
      expect(await readFile(await fileOf(dir, id), 'utf8')).toBe(before);
      expect(await adapter.versions(id)).toEqual([]);
    }
  });

  it('refuses a body patch that adds a rule block to a rule card without one', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    const id = await adapter.create(
      { format: 2, type: 'rule', title: 'Prose rule', body: 'Just text.' } as CardDraft,
      'human',
    );
    await rejects(
      adapter.patch(id, {
        body: 'Just text.\n\n## Rule\n\n```json\n{"when":[{"kind":"card_on_lage","card":"01M1E34QM03WVTE8T1RYS3AM18"}],"then":"x","unless":[]}\n```\n',
      }),
      'invalid_patch',
    );
  });

  it('still allows a body patch that leaves the structure alone', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const card = (await adapter.read(RULE))!;
    await adapter.patch(RULE, { body: card.body!.replace('My rule:', 'Our rule:') });
    expect((await adapter.read(RULE))?.body).toContain('Our rule:');
  });

  it('refuses a create whose draft brings a structured heading in the body or in a section', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const lage = {
      question: 'Q',
      options: [],
      cards: [],
      seats: [],
      edges: [],
      version: 1,
      updatedAt: '2026-10-06T00:00:00Z',
    };
    const injected =
      '## Position\n\n```json\n{"question":"Q","options":["evil"],"cards":[],"seats":[],"edges":[]}\n```';
    await rejects(
      adapter.create(
        { format: 2, type: 'lage', title: 'L', lage, body: injected } as CardDraft,
        'human',
      ),
      'invalid_card',
    );
    const sections = {
      ...(await adapter.read(DECISION))!.sections!,
      facts: 'ok\n\n## Outcome\n\ndecided',
    };
    await rejects(
      adapter.create({ format: 2, type: 'decision', title: 'D', sections } as CardDraft, 'human'),
      'invalid_card',
    );
    await rejects(adapter.patch(DECISION, { sections }), 'invalid_card');
    expect((await adapter.list({ limit: 100 })).items).toHaveLength(15);
  });

  it('stores exactly what a create draft says, including a plain body', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    const id = await adapter.create(claim({ body: 'Plain body', tags: ['a'], rating: 3 }), 'human');
    const card = (await adapter.read(id))!;
    expect(card).toMatchObject({ body: 'Plain body\n', tags: ['a'], rating: 3 });
  });
});

describe('archive and versions', () => {
  it('moves the card to _archive/<file>.v<n>.md next to it and keeps it out of the index', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const file = await fileOf(dir, WIRE);
    const text = await readFile(file, 'utf8');
    await adapter.archive(WIRE);
    await expect(stat(file)).rejects.toThrow();
    const archived = path.join(
      dir,
      'cards',
      '_archive',
      '01-wire-report-transit-restrictions.v1.md',
    );
    expect(await readFile(archived, 'utf8')).toBe(text);
    expect(await adapter.read(WIRE)).toBeUndefined();
    expect((await adapter.list()).items.map((c) => c.id)).not.toContain(WIRE);
    expect((await adapter.search({ text: 'wire report' })).items.map((c) => c.id)).not.toContain(
      WIRE,
    );
    const versions = await adapter.versions(WIRE);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
    expect(versions[0]?.archivedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    await rejects(adapter.archive(WIRE), 'not_found');
    expect(await adapter.versions(newId())).toEqual([]);
  });

  it('never overwrites a version: repeated saves get the next free number', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    let lage = (await adapter.read(LAGE))!.lage!;
    for (const v of [4, 5]) {
      lage = { ...lage, version: v };
      await adapter.patch(LAGE, { lage }, { lageVersion: v - 1 });
    }
    expect((await adapter.versions(LAGE)).map((x) => x.card.lage?.version)).toEqual([3, 4]);
    // retire the Lage: the current version 5 is archived under its own number
    await adapter.archive(LAGE);
    expect((await adapter.versions(LAGE)).map((x) => x.version)).toEqual([3, 4, 5]);
    // a taken number moves on to the next free one
    const id = await adapter.create(claim(), 'human');
    const file = await fileOf(dir, id);
    const archiveDir = path.join(dir, 'cards', '_archive');
    const stem = path.basename(file, '.md');
    await writeFile(path.join(archiveDir, `${stem}.v1.md`), await readFile(file));
    await adapter.archive(id);
    expect((await readdir(archiveDir)).filter((n) => n.startsWith(stem)).sort()).toEqual([
      `${stem}.v1.md`,
      `${stem}.v2.md`,
    ]);
  });

  it('skips an unreadable archived file without failing the history', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    await adapter.archive(WIRE);
    const archived = path.join(
      dir,
      'cards',
      '_archive',
      '01-wire-report-transit-restrictions.v1.md',
    );
    const good = await readFile(archived, 'utf8');
    const bad = good
      .replace(/^sourceDate: .*$/m, 'sourceDate: [broken')
      .replace('title:', 'derived: x\ntitle:');
    await writeFile(
      path.join(dir, 'cards', '_archive', '01-wire-report-transit-restrictions.v2.md'),
      bad.replace('derived: x', 'uri: x'),
    );
    expect((await adapter.versions(WIRE)).map((v) => v.version)).toEqual([1]);
  });
});

describe('the derived index', () => {
  it('reports files it cannot use and keeps them out of results', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    await writeCardFile(dir, 'broken.md', 'no front matter');
    await writeCardFile(
      dir,
      'invalid.md',
      `---\nid: ${newId()}\nformat: 2\ntype: claim\ntitle: T\nlayer: said\nauthor: human\n---\n`,
    );
    await writeCardFile(dir, 'dup.md', await readFile(await fileOf(dir, WIRE), 'utf8'));
    expect((await adapter.list()).items).toHaveLength(14); // the duplicated id is left out
    const problems = adapter
      .diagnostics()
      .map((d) => d.path)
      .sort();
    expect(problems).toEqual([
      'cards/01-wire-report-transit-restrictions.md',
      'cards/broken.md',
      'cards/dup.md',
      'cards/invalid.md',
    ]);
    expect(await adapter.read(WIRE)).toBeUndefined();
    await rejects(adapter.patch(WIRE, { title: 'x' }), 'not_found');
    await rejects(adapter.archive(WIRE), 'not_found');
    expect(adapter.diagnostics().find((d) => d.path.endsWith('dup.md'))?.message).toMatch(
      /duplicate id/,
    );
    await rm(path.join(dir, 'cards', 'broken.md'));
    await adapter.list();
    expect(adapter.diagnostics().map((d) => d.path)).not.toContain('cards/broken.md');
  });

  it('picks up files changed, added and removed behind its back', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const file = await fileOf(dir, WIRE);
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('Wire report announces', 'Wire report now announces'),
    );
    expect((await adapter.read(WIRE))?.title).toContain('now announces');
    const id = newId();
    await writeCardFile(dir, 'extra.md', `---\nid: ${id}\ntype: topic\ntitle: Extra\n---\n`);
    expect((await adapter.read(id))?.title).toBe('Extra');
    await unlink(path.join(dir, 'cards', 'extra.md'));
    expect(await adapter.read(id)).toBeUndefined();
  });

  it('re-reads a file that changed within the same timestamp and size (racy write)', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    const id = newId();
    const file = await writeCardFile(
      dir,
      'racy.md',
      `---\nid: ${id}\ntype: topic\ntitle: Aaaa\n---\n`,
    );
    expect((await adapter.read(id))?.title).toBe('Aaaa');
    const { mtime } = await stat(file);
    await writeFile(file, `---\nid: ${id}\ntype: topic\ntitle: Bbbb\n---\n`);
    await utimes(file, mtime, mtime);
    expect((await adapter.read(id))?.title).toBe('Bbbb');
  });

  it('rebuilds to identical query results (ADR-0033)', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    const snapshot = async () => ({
      list: (await adapter.list({ limit: 100 })).items,
      search: (await adapter.search({ text: 'tanker' })).items,
      worlds: await adapter.listWorlds(),
    });
    const before = await snapshot();
    await adapter.rebuildIndex();
    expect(await snapshot()).toEqual(before);
    expect(await snapshot()).toEqual(before);
  });

  it('never indexes archived versions as current cards and ignores temp files and symlinks', async () => {
    const dir = await copyHormuz();
    const outside = await tempDir();
    await writeFile(
      path.join(outside, 'secret.md'),
      `---\nid: ${newId()}\ntype: topic\ntitle: Outside\n---\n`,
    );
    await mkdir(path.join(dir, 'cards', 'sub', '_archive'), { recursive: true });
    await writeFile(
      path.join(dir, 'cards', 'sub', '_archive', 'x.v1.md'),
      await readFile(await fileOf(dir, WIRE)),
    );
    await writeFile(path.join(dir, 'cards', '.hidden.md'), 'x');
    await symlink(outside, path.join(dir, 'cards', 'link')).catch(() => undefined);
    const adapter = await openStore(dir);
    const titles = (await adapter.list({ limit: 100 })).items.map((c) => c.title);
    expect(titles).toHaveLength(15);
    expect(titles).not.toContain('Outside');
    expect(adapter.diagnostics()).toEqual([]);
  });

  it('reads cards from sub folders and archives next to them', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    const id = newId();
    await writeCardFile(dir, 'sub/deep.md', `---\nid: ${id}\ntype: topic\ntitle: Deep\n---\n`);
    await adapter.archive(id);
    expect(await readdir(path.join(dir, 'cards', 'sub', '_archive'))).toEqual(['deep.v1.md']);
  });
});

describe('worlds', () => {
  it('creates worlds on demand for names no world file defines, with stable ids', async () => {
    const dir = await copyHormuz({ cards: false });
    const id = newId();
    await writeCardFile(
      dir,
      'ghost.md',
      `---\nid: ${id}\nformat: 2\ntype: topic\ntitle: T\nauthor: human\nworlds: [Ghost]\n---\n`,
    );
    const a = await openStore(dir);
    const worlds = await a.listWorlds();
    const ghost = worlds.find((w) => w.name === 'Ghost')!;
    expect(ghost.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect((await a.read(id))?.worlds).toEqual([ghost.id]);
    expect((await (await openStore(dir)).listWorlds()).find((w) => w.name === 'Ghost')?.id).toBe(
      ghost.id,
    );
    // the id maps back to the name when a card is written into that world
    const created = await a.create(claim({ worlds: [ghost.id] }), 'human');
    expect(await readFile(await fileOf(dir, created), 'utf8')).toContain('worlds: [Ghost]');
  });

  it('reads worlds from world.json (envelope) and worlds/*.json (bare), and reports bad ones', async () => {
    const dir = await copyHormuz({ cards: false });
    await mkdir(path.join(dir, 'worlds'));
    await writeFile(
      path.join(dir, 'worlds', 'two.json'),
      JSON.stringify({ id: '01M1DZPW00JGXPRPG4179ZPNBA', name: 'Two' }),
    );
    await writeFile(path.join(dir, 'worlds', 'bad.json'), '{"name": 1}');
    await writeFile(path.join(dir, 'worlds', 'junk.json'), 'not json');
    const adapter = await openStore(dir);
    expect((await adapter.listWorlds()).map((w) => w.name)).toEqual(['Hormuz', 'Two']);
    expect(
      adapter
        .diagnostics()
        .map((d) => d.path)
        .sort(),
    ).toEqual(['worlds/bad.json', 'worlds/junk.json']);
  });

  it('re-resolves cards when a world file changes', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    expect((await adapter.read(NAVY))?.worlds).toEqual([WORLD]);
    await writeFile(
      path.join(dir, 'world.json'),
      JSON.stringify({ id: '01M1DZPW00JGXPRPG4179ZPNBB', name: 'Hormuz' }),
    );
    expect((await adapter.read(NAVY))?.worlds).toEqual(['01M1DZPW00JGXPRPG4179ZPNBB']);
  });
});

describe('single writer', () => {
  it('lets two adapter instances create cards concurrently without losing any', async () => {
    const dir = await copyHormuz({ cards: false });
    const a = await openStore(dir);
    const b = await openStore(dir);
    const ids = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        (i % 2 ? a : b).create(claim({ title: `Card ${i}` }), 'human'),
      ),
    );
    expect(new Set(ids).size).toBe(16);
    expect((await a.list({ limit: 100 })).items).toHaveLength(16);
    expect((await b.list({ limit: 100 })).items).toHaveLength(16);
    await expect(stat(path.join(dir, '.worldbuilder', 'write.lock'))).rejects.toThrow();
  });

  it('waits for a writer in another process, and gives up with a clear error', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir, { lock: { timeoutMs: 100, pollMs: 5 } });
    const held = await acquireLock(path.join(dir, '.worldbuilder', 'write.lock'));
    await rejects(adapter.create(claim(), 'human'), 'locked');
    await rejects(adapter.patch(newId(), { title: 'x' }), 'locked');
    await rejects(adapter.archive(newId()), 'locked');
    await held.release();
    await adapter.create(claim(), 'human');
  });

  it('keeps writing after a failed write', async () => {
    const dir = await copyHormuz();
    const adapter = await openStore(dir);
    await rejects(adapter.patch(newId(), { title: 'x' }), 'not_found');
    await adapter.patch(WIRE, { title: 'Still works' });
    expect((await adapter.read(WIRE))?.title).toBe('Still works');
  });
});

describe('search', () => {
  it('matches every word, folds case and accents, and looks into tags', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir);
    await adapter.create(claim({ title: 'Crème brûlée prices', tags: ['dessert'] }), 'human');
    await adapter.create(claim({ title: 'Prices of tea', body: 'Fraîche cream, too' }), 'human');
    const titles = async (text: string) =>
      (await adapter.search({ text })).items.map((c) => c.title).sort();
    expect(await titles('creme PRICES')).toEqual(['Crème brûlée prices']);
    expect(await titles('dessert')).toEqual(['Crème brûlée prices']);
    expect(await titles('')).toHaveLength(2);
    expect(await titles('FRAICHE tea')).toEqual(['Prices of tea']);
  });
});

describe('watching', () => {
  it('refreshes the index from file system events, without any query forcing a scan', async () => {
    const dir = await copyHormuz({ cards: false });
    const adapter = await openStore(dir, { watch: true, debounceMs: 5 });
    const id = newId();
    await writeCardFile(dir, 'watched.md', `---\nid: ${id}\ntype: topic\ntitle: Watched\n---\n`);
    await vi.waitFor(
      async () => expect((await adapter.list()).items.map((c) => c.id)).toContain(id),
      {
        timeout: 5000,
        interval: 20,
      },
    );
    // an own write is visible at once
    const created = await adapter.create(claim(), 'human');
    expect((await adapter.read(created))?.id).toBe(created);
    // a miss falls back to a rescan even if no event was delivered yet
    const id2 = newId();
    await writeCardFile(dir, 'quiet.md', `---\nid: ${id2}\ntype: topic\ntitle: Quiet\n---\n`);
    expect((await adapter.read(id2))?.title).toBe('Quiet');
    adapter.close();
    // after close every query checks the files again
    const id3 = newId();
    await writeCardFile(dir, 'after-close.md', `---\nid: ${id3}\ntype: topic\ntitle: After\n---\n`);
    expect((await adapter.list()).items.map((c) => c.id)).toContain(id3);
  });
});
