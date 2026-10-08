// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLocalStateError } from './errors.js';
import { createLocalStateStore } from './store.js';
import { CARD_A, CARD_B, LAGE, tempDir } from './test-helpers.js';

const AGENT = 'agent:test-agent' as const;
const place = (cardId = CARD_A) => ({
  kind: 'place_card' as const,
  payload: { lageId: LAGE, cardId, x: 10, y: 20 },
  rationale: 'supports the question',
});

async function open(opts: { now?: () => Date } = {}) {
  const base = await tempDir();
  const stateDir = path.join(base, 'state');
  const store = await createLocalStateStore({ explicitPath: stateDir, ...opts });
  return { base, stateDir, store };
}

const rejects = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e) => isLocalStateError(e) && e.code === code);

describe('createLocalStateStore', () => {
  it('creates the state directory and writes only below it', async () => {
    const { base, stateDir, store } = await open();
    const p = await store.createProposal(place(), AGENT);
    await store.saveStance(CARD_A, { position: 'believed', weight: 2 });
    await store.appendGateLog({
      cardId: CARD_A,
      item: 'card',
      target: 'screen',
      decision: 'allow',
      reason: 'rule_allow',
      ruleId: 'r',
    });
    expect(store.stateDir).toBe(stateDir);
    expect((await readdir(base)).sort()).toEqual(['state']);
    expect((await readdir(stateDir)).sort()).toEqual(['gate-log.jsonl', 'proposals', 'stances']);
    expect(await readdir(path.join(stateDir, 'proposals'))).toEqual([`${p.id}.json`]);
  });

  it('resolves the per-OS default from the injected environment', async () => {
    const base = await tempDir();
    const store = await createLocalStateStore({
      platform: 'linux',
      env: { XDG_STATE_HOME: path.join(base, 'xdg') },
      homedir: base,
    });
    expect(store.stateDir.endsWith(path.join('xdg', 'worldbuilder'))).toBe(true);
  });

  it('refuses a state directory inside a store root or a Git working tree', async () => {
    const base = await tempDir();
    await mkdir(path.join(base, 'store'));
    await mkdir(path.join(base, 'repo', '.git'), { recursive: true });
    await rejects(
      createLocalStateStore({
        explicitPath: path.join(base, 'store', 'state'),
        storeRoots: [path.join(base, 'store')],
      }),
      'unsafe_state_dir',
    );
    await rejects(
      createLocalStateStore({ explicitPath: path.join(base, 'repo', 'state') }),
      'unsafe_state_dir',
    );
    expect(await readdir(path.join(base, 'store'))).toEqual([]); // nothing was created
  });
});

describe('proposals', () => {
  it('creates a pending proposal file validated against the schema', async () => {
    const { stateDir, store } = await open({ now: () => new Date('2026-10-06T10:00:00.000Z') });
    const p = await store.createProposal(place(), AGENT);
    expect(p).toMatchObject({ author: AGENT, kind: 'place_card', status: 'pending' });
    expect(p.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(p.decidedBy).toBeUndefined();
    const onDisk = JSON.parse(
      await readFile(path.join(stateDir, 'proposals', `${p.id}.json`), 'utf8'),
    );
    expect(onDisk).toEqual(p);
    expect(await store.getProposal(p.id)).toEqual(p);
    expect(await store.getProposal('01J9Z0000000000000000000ZZ')).toBeUndefined();
  });

  it('rejects invalid input: wrong payload for the kind, bad author, unknown fields, bad ids', async () => {
    const { store } = await open();
    await rejects(
      store.createProposal({ kind: 'place_card', payload: { cardId: CARD_A } } as never, AGENT),
      'invalid',
    );
    await rejects(store.createProposal(place(), 'human' as never), 'invalid');
    await rejects(store.createProposal({ ...place(), id: CARD_A } as never, AGENT), 'invalid');
    await rejects(store.createProposal({ kind: 'nope', payload: {} } as never, AGENT), 'invalid');
    await rejects(store.getProposal('../../etc/passwd'), 'invalid');
    await rejects(store.decideProposal('nope', 'accepted'), 'invalid');
    expect((await store.listProposals()).proposals).toEqual([]);
  });

  it('accept and reject record decidedBy and decidedAt; a decision is final', async () => {
    let now = new Date('2026-10-06T10:00:00.000Z');
    const { stateDir, store } = await open({ now: () => now });
    const a = await store.createProposal(place(CARD_A), AGENT);
    const b = await store.createProposal(place(CARD_B), AGENT);
    now = new Date('2026-10-06T10:05:00.000Z');
    const accepted = await store.decideProposal(a.id, 'accepted');
    const rejected = await store.decideProposal(b.id, 'rejected');
    expect(accepted).toMatchObject({
      status: 'accepted',
      decidedBy: 'human',
      decidedAt: '2026-10-06T10:05:00.000Z',
    });
    expect(rejected).toMatchObject({ status: 'rejected', decidedBy: 'human' });
    expect(rejected.decidedAt! > accepted.decidedAt!).toBe(true); // stamps never tie
    expect(
      JSON.parse(await readFile(path.join(stateDir, 'proposals', `${a.id}.json`), 'utf8')),
    ).toEqual(accepted);
    await rejects(store.decideProposal(a.id, 'rejected'), 'conflict');
    await rejects(store.decideProposal(a.id, 'accepted'), 'conflict');
    await rejects(store.decideProposal('01J9Z0000000000000000000ZZ', 'accepted'), 'not_found');
    await rejects(store.decideProposal(a.id, 'pending' as never), 'invalid');
    expect(await store.getProposal(a.id)).toEqual(accepted);
  });

  it('two concurrent decisions: exactly one wins', async () => {
    const { store } = await open();
    const p = await store.createProposal(place(), AGENT);
    const results = await Promise.allSettled([
      store.decideProposal(p.id, 'accepted'),
      store.decideProposal(p.id, 'rejected'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('concurrent creates produce distinct ids and files, and all are listed once', async () => {
    const { store } = await open();
    const made = await Promise.all(
      Array.from({ length: 50 }, () => store.createProposal(place(), AGENT)),
    );
    expect(new Set(made.map((p) => p.id)).size).toBe(50);
    const page = await store.listProposals({ limit: 200 });
    expect(page.proposals).toHaveLength(50);
    expect(new Set(page.proposals.map((p) => p.createdAt)).size).toBe(50); // unique change stamps
  });

  it('does not count a damaged or foreign file, and ignores temp files', async () => {
    const { stateDir, store } = await open();
    const good = await store.createProposal(place(), AGENT);
    const dir = path.join(stateDir, 'proposals');
    await writeFile(path.join(dir, '01J9Z0000000000000000000ZZ.json'), '{ not json');
    await writeFile(path.join(dir, '01J9Z0000000000000000000YY.json'), JSON.stringify({ id: 'x' }));
    await writeFile(path.join(dir, '.01J9Z0000000000000000000XX.json.abc.tmp'), '{}');
    await writeFile(path.join(dir, 'README.txt'), 'hi');
    expect((await store.listProposals()).proposals.map((p) => p.id)).toEqual([good.id]);
  });

  describe('listing and the changedSince cursor (ADR-0032)', () => {
    it('lists oldest first and always returns a nextCursor, also when empty', async () => {
      const { store } = await open();
      const empty = await store.listProposals();
      expect(empty.proposals).toEqual([]);
      expect(empty.nextCursor).toBeTruthy();
      const a = await store.createProposal(place(), AGENT);
      const b = await store.createProposal(place(CARD_B), AGENT);
      const page = await store.listProposals();
      expect(page.proposals.map((p) => p.id)).toEqual([a.id, b.id]);
      expect(page.nextCursor).toBeTruthy();
      // the cursor of an empty first poll still catches everything created later
      expect(
        (await store.listProposals({ changedSince: empty.nextCursor! })).proposals,
      ).toHaveLength(2);
    });

    it('polling returns each change exactly once: creation, then decision', async () => {
      const { store } = await open();
      let cursor = (await store.listProposals()).nextCursor!;
      const seen: string[] = [];
      const poll = async () => {
        const page = await store.listProposals({ changedSince: cursor });
        cursor = page.nextCursor!;
        return page.proposals.map((p) => `${p.id}:${p.status}`);
      };
      expect(await poll()).toEqual([]);
      const a = await store.createProposal(place(), AGENT);
      seen.push(...(await poll()));
      expect(await poll()).toEqual([]); // nothing repeated
      const b = await store.createProposal(place(CARD_B), AGENT);
      await store.decideProposal(a.id, 'accepted');
      seen.push(...(await poll())); // b created, a decided: both new
      expect(await poll()).toEqual([]);
      expect(seen).toEqual([`${a.id}:pending`, `${b.id}:pending`, `${a.id}:accepted`]);
    });

    it('a restart resumes change stamps after the newest on disk', async () => {
      const base = await tempDir();
      const stateDir = path.join(base, 'state');
      const future = new Date('2030-01-01T00:00:00.000Z');
      const first = await createLocalStateStore({ explicitPath: stateDir, now: () => future });
      const a = await first.createProposal(place(), AGENT);
      const second = await createLocalStateStore({
        explicitPath: stateDir,
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      });
      const b = await second.createProposal(place(CARD_B), AGENT);
      expect(b.createdAt > a.createdAt).toBe(true);
    });

    it('pages with limit and cursor without gaps or repeats', async () => {
      const { store } = await open();
      const made = [];
      for (let i = 0; i < 7; i++) made.push((await store.createProposal(place(), AGENT)).id);
      const got: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await store.listProposals({ limit: 3, ...(cursor ? { cursor } : {}) });
        got.push(...page.proposals.map((p) => p.id));
        if (page.proposals.length < 3) break;
        cursor = page.nextCursor;
      }
      expect(got).toEqual(made);
    });

    it('filters by status and lage; the cursor moves over filtered-out changes', async () => {
      const { store } = await open();
      const other = '01J9Z0000000000000000000P4';
      const a = await store.createProposal(place(), AGENT);
      const b = await store.createProposal(
        { kind: 'comment', payload: { text: 'hi', lageId: other } },
        AGENT,
      );
      await store.decideProposal(a.id, 'accepted');
      expect((await store.listProposals({ status: 'pending' })).proposals.map((p) => p.id)).toEqual(
        [b.id],
      );
      expect(
        (await store.listProposals({ status: 'accepted' })).proposals.map((p) => p.id),
      ).toEqual([a.id]);
      expect((await store.listProposals({ lageId: other })).proposals.map((p) => p.id)).toEqual([
        b.id,
      ]);
      const none = await store.listProposals({ status: 'rejected' });
      expect(none.proposals).toEqual([]);
      expect((await store.listProposals({ changedSince: none.nextCursor! })).proposals).toEqual([]);
    });

    it('cursor and changedSince together use the later one; bad input is rejected', async () => {
      const { store } = await open();
      await store.createProposal(place(), AGENT);
      const mid = (await store.listProposals()).nextCursor!;
      await store.createProposal(place(CARD_B), AGENT);
      const early = (await store.listProposals({ limit: 1 })).nextCursor!;
      expect(
        (await store.listProposals({ cursor: early, changedSince: mid })).proposals,
      ).toHaveLength(1);
      await rejects(store.listProposals({ cursor: 'garbage' }), 'invalid');
      await rejects(
        store.listProposals({ changedSince: Buffer.from('2026~x').toString('base64url') }),
        'invalid',
      );
      await rejects(store.listProposals({ limit: 0 }), 'invalid');
      await rejects(store.listProposals({ limit: 201 }), 'invalid');
    });
  });
});

describe('stances (ADR-0008)', () => {
  it('creates a stance without history and keeps every previous version on change', async () => {
    let now = new Date('2026-10-06T10:00:00.000Z');
    const { stateDir, store } = await open({ now: () => now });
    expect(await store.getStance(CARD_A)).toBeUndefined();
    const s1 = await store.saveStance(CARD_A, { position: 'believed', weight: 3, note: 'first' });
    expect(s1).toEqual({
      cardId: CARD_A,
      position: 'believed',
      weight: 3,
      note: 'first',
      updatedAt: '2026-10-06T10:00:00.000Z',
      history: [],
    });
    now = new Date('2026-10-06T11:00:00.000Z');
    await store.saveStance(CARD_A, { position: 'rejected', weight: 1 });
    now = new Date('2026-10-06T12:00:00.000Z');
    const s3 = await store.saveStance(CARD_A, { position: 'undecided', weight: 2, note: 'third' });
    expect(s3.history).toEqual([
      { position: 'believed', weight: 3, note: 'first', updatedAt: '2026-10-06T10:00:00.000Z' },
      { position: 'rejected', weight: 1, updatedAt: '2026-10-06T11:00:00.000Z' },
    ]);
    expect(await store.getStance(CARD_A)).toEqual(s3);
    expect(await readdir(path.join(stateDir, 'stances'))).toEqual([`${CARD_A}.json`]);
  });

  it('lists stances, one file per card', async () => {
    const { store } = await open();
    expect(await store.listStances()).toEqual([]);
    await store.saveStance(CARD_B, { position: 'rejected', weight: 1 });
    await store.saveStance(CARD_A, { position: 'believed', weight: 1 });
    expect((await store.listStances()).map((s) => s.cardId).sort()).toEqual([CARD_A, CARD_B]);
  });

  it('validates input and card ids (no path traversal)', async () => {
    const { base, store } = await open();
    await rejects(store.saveStance(CARD_A, { position: 'maybe', weight: 1 } as never), 'invalid');
    await rejects(
      store.saveStance(CARD_A, { position: 'believed', weight: 4 } as never),
      'invalid',
    );
    await rejects(
      store.saveStance(CARD_A, { position: 'believed', weight: 1, confidence: 90 } as never),
      'invalid',
    );
    await rejects(
      store.saveStance('../../outside', { position: 'believed', weight: 1 }),
      'invalid',
    );
    await rejects(store.getStance('..\\x'), 'invalid');
    expect(await readdir(base)).toEqual(['state']);
  });

  it('refuses to read a stored stance that does not validate', async () => {
    const { stateDir, store } = await open();
    await store.saveStance(CARD_A, { position: 'believed', weight: 1 });
    await writeFile(
      path.join(stateDir, 'stances', `${CARD_A}.json`),
      JSON.stringify({ cardId: CARD_A }),
    );
    await rejects(store.getStance(CARD_A), 'invalid');
    await rejects(store.saveStance(CARD_A, { position: 'believed', weight: 2 }), 'invalid');
  });

  it('concurrent saves keep all versions', async () => {
    const { store } = await open();
    await Promise.all(
      [1, 2, 3, 2, 1].map((weight) => store.saveStance(CARD_A, { position: 'believed', weight })),
    );
    expect((await store.getStance(CARD_A))!.history).toHaveLength(4);
  });
});

describe('gate log and rules through the store', () => {
  it('writes gate-log.jsonl with the configured rotation', async () => {
    const base = await tempDir();
    const store = await createLocalStateStore({
      explicitPath: path.join(base, 's'),
      gateLog: { maxBytes: 400, keep: 1 },
    });
    for (let i = 0; i < 12; i++) {
      await store.appendGateLog({
        cardId: CARD_A,
        item: 'card',
        target: 'demo',
        decision: 'deny',
        reason: 'default_deny' as const,
      });
    }
    expect((await readdir(path.join(base, 's'))).sort()).toEqual([
      'gate-log.jsonl',
      'gate-log.jsonl.1',
    ]);
  });

  it('loads gate-rules.yaml from the state directory and fails closed when it is invalid', async () => {
    const { stateDir, store } = await open();
    expect(await store.loadGateRules()).toMatchObject({ ok: true, missing: true });
    await writeFile(
      path.join(stateDir, 'gate-rules.yaml'),
      'rules:\n  - { id: s, effect: allow, targets: [screen], match: {} }\n',
    );
    expect(await store.loadGateRules()).toMatchObject({
      ok: true,
      rules: { rules: [{ id: 's' }] },
    });
    await writeFile(path.join(stateDir, 'gate-rules.yaml'), 'rules: nonsense');
    expect(await store.loadGateRules()).toMatchObject({ ok: false });
  });
});

describe('review hardening', () => {
  it('refuses at open a symlinked proposals dir, stances dir, rules file or log file', async () => {
    for (const name of [
      'proposals',
      'stances',
      'gate-rules.yaml',
      'gate-log.jsonl',
      'gate-log.jsonl.2',
    ]) {
      const base = await tempDir();
      const stateDir = path.join(base, 'state');
      await mkdir(stateDir);
      await mkdir(path.join(base, 'elsewhere'));
      try {
        await symlink(path.join(base, 'elsewhere'), path.join(stateDir, name));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // Windows without privilege
        throw e;
      }
      await rejects(createLocalStateStore({ explicitPath: stateDir }), 'unsafe_state_dir');
    }
  });

  it.skipIf(process.platform === 'win32')(
    'tightens an existing directory to owner-only',
    async () => {
      const base = await tempDir();
      const stateDir = path.join(base, 'state');
      await mkdir(stateDir, { mode: 0o755 });
      await createLocalStateStore({ explicitPath: stateDir });
      expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
    },
  );

  it('ignores a proposal whose inner id differs from its file name, and reports it', async () => {
    const { stateDir, store } = await open();
    const p = await store.createProposal(place(), AGENT);
    const other = '01J9Z0000000000000000000R5';
    await writeFile(path.join(stateDir, 'proposals', `${other}.json`), JSON.stringify(p));
    expect((await store.listProposals()).proposals.map((x) => x.id)).toEqual([p.id]);
    expect(await store.getProposal(other)).toBeUndefined();
    await rejects(store.decideProposal(other, 'accepted'), 'not_found');
    expect((await store.damagedFiles()).proposals).toEqual([`${other}.json`]);
  });

  it('a stance whose inner card id differs from its file name is invalid; listing skips and reports damage', async () => {
    const { stateDir, store } = await open();
    const good = await store.saveStance(CARD_A, { position: 'believed', weight: 1 });
    await writeFile(path.join(stateDir, 'stances', `${CARD_B}.json`), JSON.stringify(good));
    await rejects(store.getStance(CARD_B), 'invalid');
    const broken = '01J9Z0000000000000000000R5';
    await writeFile(path.join(stateDir, 'stances', `${broken}.json`), '{ nope');
    expect(await store.listStances()).toEqual([good]);
    expect(await store.damagedFiles()).toEqual({
      proposals: [],
      stances: [`${CARD_B}.json`, `${broken}.json`].sort(),
    });
  });

  it('rethrows non-validation I/O errors from listStances and damagedFiles', async () => {
    const { stateDir, store } = await open();
    // A directory in place of a stance file makes readFile fail with EISDIR (not "invalid").
    await mkdir(path.join(stateDir, 'stances', `${CARD_B}.json`), { recursive: true });
    await expect(store.listStances()).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(store.damagedFiles()).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('reports no damage on a clean state', async () => {
    const { store } = await open();
    await store.createProposal(place(), AGENT);
    expect(await store.damagedFiles()).toEqual({ proposals: [], stances: [] });
  });
});
