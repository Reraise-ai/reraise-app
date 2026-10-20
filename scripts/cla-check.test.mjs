// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  MARKER,
  SIGNATURE_FILE,
  SIGNED_BODY,
  evaluate,
  isSigningComment,
  readEntities,
  run,
} from './cla-check.mjs';
import { GitHubApiError } from './lib.mjs';
import { makeTree } from './test-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const alice = { login: 'alice', id: 1 };
const bob = { login: 'bob', id: 2 };
const dependabot = { login: 'dependabot[bot]', id: 49699333 };
/** The real account behind Claude Code's commit e-mail, as the GitHub API returns it for a commit. */
const claude = { login: 'claude', id: 81847, type: 'User' };
const copilot = { login: 'copilot-swe-agent[bot]', id: 198982749, type: 'Bot' };
const appBot = { login: 'some-app', id: 3, type: 'Bot' };
const pr = (user = alice, extra = {}) => ({
  number: 7,
  state: 'open',
  user,
  head: { sha: 'abc' },
  changed_files: 1,
  commits: 1,
  ...extra,
});
const file = (filename, extra = {}) => ({ filename, status: 'modified', ...extra });
const commitBy = (author) => ({ author });
const signed = (person) => ({ login: person.login, id: person.id });
const BOARD = [file('apps/board/src/x.ts')];

describe('evaluate', () => {
  /** @type {Array<[string, any, string, string[]]>} */
  const cases = [
    [
      'docs and Apache code only',
      { files: [file('docs/a.md'), file('packages/core/src/a.ts')] },
      'success',
      [],
    ],
    ['AGPL file, author unsigned', { files: BOARD }, 'failure', ['alice']],
    ['AGPL file, author signed', { files: BOARD, signatures: [signed(alice)] }, 'success', []],
    [
      'only a deletion in services/api',
      { files: [file('services/api/src/a.ts', { status: 'removed' })] },
      'failure',
      ['alice'],
    ],
    [
      'rename out of packages/mcp-server',
      {
        files: [
          file('docs/a.ts', { status: 'renamed', previous_filename: 'packages/mcp-server/a.ts' }),
        ],
      },
      'failure',
      ['alice'],
    ],
    [
      'rename into e2e',
      { files: [file('e2e/tests/a.ts', { status: 'renamed', previous_filename: 'docs/a.ts' })] },
      'failure',
      ['alice'],
    ],
    [
      'look-alike directories',
      { files: [file('apps/board-extra/x'), file('e2e-tools/x')] },
      'success',
      [],
    ],
    [
      'author listed in an entity record',
      { files: BOARD, entities: [{ contributors: ['ALICE'] }] },
      'success',
      [],
    ],
    [
      'login renamed, same id',
      { files: BOARD, signatures: [{ login: 'alice-old', id: 1 }] },
      'success',
      [],
    ],
    [
      'same login, other id (taken-over name)',
      { files: BOARD, signatures: [{ login: 'alice', id: 99 }] },
      'failure',
      ['alice'],
    ],
    [
      'dependabot alone',
      { pr: pr(dependabot), files: BOARD, commits: [commitBy(dependabot)] },
      'success',
      [],
    ],
    [
      'commit author without account, PR author signed',
      { files: BOARD, commits: [commitBy(null)], signatures: [signed(alice)] },
      'success',
      [],
    ],
    [
      'commit author with account unsigned, PR author signed',
      { files: BOARD, commits: [commitBy(bob)], signatures: [signed(alice)] },
      'failure',
      ['bob'],
    ],
    [
      'commit by the agent account claude, PR author signed',
      { files: BOARD, commits: [commitBy(claude)], signatures: [signed(alice)] },
      'success',
      [],
    ],
    [
      'commit by the agent account claude, PR author unsigned',
      { files: BOARD, commits: [commitBy(claude)] },
      'failure',
      ['alice'],
    ],
    [
      'commits by bot accounts (type Bot, login [bot]), PR author signed',
      { files: BOARD, commits: [commitBy(copilot), commitBy(appBot)], signatures: [signed(alice)] },
      'success',
      [],
    ],
    [
      'PR opened by a bot other than Dependabot stays red',
      { pr: pr(copilot), files: BOARD, commits: [commitBy(copilot)] },
      'failure',
      ['copilot-swe-agent[bot]'],
    ],
    [
      'path in other case (Apps/Board) counts as AGPL',
      { files: [file('Apps/Board/x.ts')] },
      'failure',
      ['alice'],
    ],
    ['more than 3000 files', { pr: pr(alice, { changed_files: 3001 }), files: BOARD }, 'error', []],
    ['more than 250 commits', { pr: pr(alice, { commits: 251 }), files: BOARD }, 'error', []],
  ];
  it.each(cases)('%s', (_name, input, state, missing) => {
    const result = evaluate({ pr: pr(), commits: [], signatures: [], entities: [], ...input });
    expect(result?.state).toBe(state);
    expect(result.missing).toEqual(missing);
    if (state === 'failure') expect(result.description).toContain(`@${missing[0]}`);
  });
});

describe('isSigningComment', () => {
  it.each([
    ['I have read the Reraise Individual CLA v1.0 and I agree to it.', true],
    ['  I have read the Reraise Individual CLA v1.0 and I agree to it\n', true],
    ['i have read the reraise individual cla v1.0 and i agree to it.', true],
    ['I have read the Reraise Individual CLA v1.0 and I agree to it. Thanks!', false],
    ['I have read the Reraise Individual CLA v2.0 and I agree to it.', false],
    ['I agree', false],
    [undefined, false],
  ])('%j -> %s', (body, expected) => {
    expect(isSigningComment(body)).toBe(expected);
  });
});

describe('readEntities', () => {
  const acme = {
    entity: 'Acme',
    signatory: 'Jane Doe',
    title: 'CTO',
    date: '2026-10-20',
    claVersion: '1.0',
    contributors: ['bob'],
  };
  it('reads the json records and ignores other files', () => {
    const root = makeTree({
      'legal/cla/entities/acme.json': JSON.stringify(acme),
      'legal/cla/entities/.gitkeep': '',
    });
    expect(readEntities(root)).toEqual([acme]);
    expect(readEntities(makeTree({}))).toEqual([]);
  });

  it('throws on a record without a required field', () => {
    const noList = { ...acme, contributors: undefined };
    const root = makeTree({ 'legal/cla/entities/acme.json': JSON.stringify(noList) });
    expect(() => readEntities(root)).toThrow(/acme\.json: missing contributors/);
  });

  it('accepts every real record of the repository', () => {
    expect(() => readEntities(ROOT)).not.toThrow();
  });
});

/** A stand-in for the GitHub API that keeps the signature file and records every call. */
/**
 * @param {{ files?: any[], commits?: any[], signatures?: any[], comments?: any[],
 *   fail?: (method: string, route: string) => unknown }} [options]
 */
function fakeApi({ files = BOARD, commits = [], signatures = [], comments = [], fail } = {}) {
  const calls = [];
  let store = { version: 1, agreement: 'individual', agreementVersion: '1.0', signatures };
  let sha = 's0';
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64');
  const api = {
    calls,
    get store() {
      return store;
    },
    async request(method, route, body) {
      calls.push({ method, route, body });
      const failure = fail?.(method, route);
      if (failure) throw failure instanceof Error ? failure : new GitHubApiError('500', 500);
      if (method === 'GET' && route === '/pulls/7') return pr(alice);
      if (method === 'GET' && route.startsWith(`/contents/${SIGNATURE_FILE}`)) {
        return { content: encode(store), sha };
      }
      if (method === 'PUT') {
        if (body.sha !== sha) throw new GitHubApiError('conflict', 409);
        store = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
        sha = `s${Number(sha.slice(1)) + 1}`;
      }
      return {};
    },
    async list(route) {
      calls.push({ method: 'LIST', route });
      const failure = fail?.('LIST', route);
      if (failure) throw failure instanceof Error ? failure : new GitHubApiError('500', 500);
      if (route.endsWith('/files')) return files;
      if (route.endsWith('/commits')) return commits;
      return comments;
    },
  };
  return api;
}

const comment = (user, body, id = 100) => ({
  id,
  user,
  body,
  created_at: '2026-10-20T10:00:00Z',
  html_url: `https://github.com/o/r/pull/7#issuecomment-${id}`,
});
const SENTENCE = 'I have read the Reraise Individual CLA v1.0 and I agree to it.';
const commentEvent = (c) => ({ issue: { number: 7, pull_request: {} }, comment: c });
const ctx = (api, eventName, event) => ({
  api,
  eventName,
  event,
  entities: [],
  agreementSha256: 'h',
  targetUrl: 'u',
});
const statuses = (api) => api.calls.filter((c) => c.route.startsWith('/statuses/'));

describe('run', () => {
  it('sets failure and writes one bot comment, edited on the next run', async () => {
    const api = fakeApi();
    await run(ctx(api, 'pull_request_target', { pull_request: pr() }));
    expect(statuses(api)[0].body).toMatchObject({ state: 'failure', context: 'CLA' });
    expect(
      api.calls.find((c) => c.method === 'POST' && c.route === '/issues/7/comments'),
    ).toBeTruthy();

    const again = fakeApi({
      comments: [{ id: 5, user: { login: 'github-actions[bot]' }, body: MARKER }],
    });
    await run(ctx(again, 'pull_request_target', { pull_request: pr() }));
    expect(
      again.calls.find((c) => c.method === 'PATCH' && c.route === '/issues/comments/5'),
    ).toBeTruthy();
    expect(
      again.calls.find((c) => c.method === 'POST' && c.route === '/issues/7/comments'),
    ).toBeUndefined();
  });

  it('does not read the signature store for a pull request without AGPL files', async () => {
    const api = fakeApi({
      files: [file('docs/a.md')],
      fail: (_m, r) => r.startsWith('/contents/'),
    });
    const result = await run(ctx(api, 'pull_request_target', { pull_request: pr() }));
    expect(result?.state).toBe('success');
  });

  it('records the signing sentence and turns green', async () => {
    const api = fakeApi();
    const result = await run(ctx(api, 'issue_comment', commentEvent(comment(alice, SENTENCE))));
    expect(result?.state).toBe('success');
    expect(api.store.signatures).toEqual([
      expect.objectContaining({
        login: 'alice',
        id: 1,
        pullRequest: 7,
        commentId: 100,
        agreementVersion: '1.0',
        agreementSha256: 'h',
      }),
    ]);
  });

  it('records a second comment of the same person once', async () => {
    const api = fakeApi();
    await run(ctx(api, 'issue_comment', commentEvent(comment(alice, SENTENCE, 100))));
    await run(ctx(api, 'issue_comment', commentEvent(comment(alice, SENTENCE.toUpperCase(), 101))));
    expect(api.store.signatures).toHaveLength(1);
  });

  it('records nothing for other text, and a third party signs only for itself', async () => {
    const api = fakeApi();
    const result = await run(ctx(api, 'issue_comment', commentEvent(comment(bob, 'I agree'))));
    expect(api.store.signatures).toEqual([]);
    expect(result?.state).toBe('failure');
    await run(ctx(api, 'issue_comment', commentEvent(comment(bob, SENTENCE))));
    expect(api.store.signatures.map((s) => s.login)).toEqual(['bob']);
    expect(statuses(api).at(-1).body.state).toBe('failure');
  });

  it('retries the write when another run changed the store in between', async () => {
    const api = fakeApi();
    let first = true;
    const request = api.request;
    api.request = async (method, route, body) => {
      if (method === 'PUT' && first) {
        first = false;
        throw new GitHubApiError('conflict', 409);
      }
      return request(method, route, body);
    };
    await run(ctx(api, 'issue_comment', commentEvent(comment(alice, SENTENCE))));
    expect(api.store.signatures).toHaveLength(1);
  });

  it.each([
    ['the file list', (m, r) => m === 'LIST' && r.endsWith('/files')],
    ['the signature store', (_m, r) => r.startsWith('/contents/')],
    [
      'a timeout',
      (m, r) =>
        m === 'LIST' && r.endsWith('/commits') && new DOMException('timeout', 'TimeoutError'),
    ],
  ])('sets error and never success when %s fails', async (_name, fail) => {
    const api = fakeApi({ signatures: [signed(alice)], fail });
    await expect(run(ctx(api, 'pull_request_target', { pull_request: pr() }))).rejects.toThrow();
    expect(statuses(api).map((s) => s.body.state)).toEqual(['error']);
  });

  it('records a signing comment of an earlier, lost run on the next run, once', async () => {
    const api = fakeApi({ comments: [comment(alice, SENTENCE, 90)] });
    const result = await run(ctx(api, 'pull_request_target', { pull_request: pr() }));
    expect(result?.state).toBe('success');
    expect(api.store.signatures).toEqual([expect.objectContaining({ id: 1, commentId: 90 })]);
    await run(ctx(api, 'pull_request_target', { pull_request: pr() }));
    expect(api.store.signatures).toHaveLength(1);
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('does not count a signing sentence that was added by editing a comment', async () => {
    const edited = { ...comment(alice, SENTENCE, 90), updated_at: '2026-10-20T11:00:00Z' };
    const api = fakeApi({ comments: [edited] });
    const result = await run(ctx(api, 'pull_request_target', { pull_request: pr() }));
    expect(result?.state).toBe('failure');
    expect(api.store.signatures).toEqual([]);
  });

  it('turns green from the store it wrote, even if a later read is stale', async () => {
    const api = fakeApi();
    const request = api.request;
    const stale = Buffer.from(JSON.stringify({ signatures: [] })).toString('base64');
    let written = false;
    api.request = async (method, route, body) => {
      if (method === 'PUT') written = true;
      if (written && method === 'GET' && route.startsWith('/contents/')) {
        return { content: stale, sha: 's0' };
      }
      return request(method, route, body);
    };
    const result = await run(ctx(api, 'issue_comment', commentEvent(comment(alice, SENTENCE))));
    expect(result?.state).toBe('success');
    expect(statuses(api).at(-1).body.state).toBe('success');
  });

  it('edits the bot comment to "signed" when green, and posts none if there was none', async () => {
    const own = { id: 5, user: { login: 'github-actions[bot]' }, body: `${MARKER} old` };
    const api = fakeApi({ signatures: [signed(alice)], comments: [own] });
    await run(ctx(api, 'pull_request_target', { pull_request: pr() }));
    const patch = api.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body.body).toBe(SIGNED_BODY);

    const quiet = fakeApi({ signatures: [signed(alice)] });
    await run(ctx(quiet, 'pull_request_target', { pull_request: pr() }));
    expect(quiet.calls.filter((c) => c.method === 'POST' && c.route.includes('/comments'))).toEqual(
      [],
    );
  });

  it('explains a missing branch cla-signatures in the error status', async () => {
    const api = fakeApi({
      fail: (m, r) => m === 'GET' && r.startsWith('/contents/') && new GitHubApiError('404', 404),
    });
    await expect(run(ctx(api, 'pull_request_target', { pull_request: pr() }))).rejects.toThrow();
    const [status] = statuses(api);
    expect(status.body.state).toBe('error');
    expect(status.body.description).toContain('branch cla-signatures');
  });

  it('sets error when an entity record is broken', async () => {
    const api = fakeApi();
    const broken = () => {
      throw new Error('legal/cla/entities/x.json: missing title');
    };
    await expect(
      run({ ...ctx(api, 'pull_request_target', { pull_request: pr() }), entities: broken }),
    ).rejects.toThrow();
    expect(statuses(api).map((s) => s.body.state)).toEqual(['error']);
  });

  it('says "please split" for more than 3000 files instead of a list error', async () => {
    const api = fakeApi({
      fail: (m, r) => m === 'LIST' && r.endsWith('/files') && new Error('more than 30 pages'),
    });
    const big = pr(alice, { changed_files: 3001 });
    const result = await run(ctx(api, 'pull_request_target', { pull_request: big }));
    expect(result?.state).toBe('error');
    const [status] = statuses(api);
    expect(status.body.description).toContain('please split');
    expect(api.calls.filter((x) => x.method === 'LIST')).toEqual([]);
  });

  it('ignores comments on issues and closed pull requests', async () => {
    const api = fakeApi();
    expect(
      await run(
        ctx(api, 'issue_comment', { issue: { number: 7 }, comment: comment(alice, SENTENCE) }),
      ),
    ).toBeNull();
    const closed = await run(
      ctx(api, 'pull_request_target', { pull_request: pr(alice, { state: 'closed' }) }),
    );
    expect(closed).toBeNull();
    expect(statuses(api)).toEqual([]);
  });
});

describe('agreement texts', () => {
  // A signature stores the hash of the text it was given for. Changing a text without a new
  // CLA version would attach old signatures to new words.
  it.each([
    ['CLA-INDIVIDUAL.md', '0ab13369e1d92d2b4fe134980b93cfa195f49fa1df08761f06517147076c09dd'],
    ['CLA-ENTITY.md', '68d9afb562d55f6109612233716c860f1e5897f9c44b95f332522dc494c27c33'],
  ])('%s is unchanged (new CLA version needed to change it)', (file, expected) => {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(ROOT, 'legal/cla', file)))
      .digest('hex');
    expect(
      actual,
      `${file} changed: a new CLA version is needed (new version number, new SENTENCE, new hash here)`,
    ).toBe(expected);
  });
});

describe('workflows', () => {
  const dir = path.join(ROOT, '.github/workflows');
  const workflows = readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({ f, wf: parse(readFileSync(path.join(dir, f), 'utf8')) }));

  it('runs the CLA and DCO scripts only from the default branch, never pull request code', () => {
    const users = workflows.filter(({ wf }) =>
      Object.values(wf.jobs).some((j) =>
        j.steps?.some((st) => /scripts\/(cla|dco)-check\.mjs/.test(st.run ?? '')),
      ),
    );
    expect(users.map((u) => u.f)).toEqual(['cla.yml']);
    const wf = users[0]?.wf;
    expect(Object.keys(wf.on).sort()).toEqual(['issue_comment', 'pull_request_target']);
    for (const job of Object.values(wf.jobs)) {
      for (const st of job.steps) {
        expect(st.with?.ref).toBeUndefined();
        expect(st.run ?? '').not.toMatch(/\b(pnpm|npm|yarn)\b/);
      }
    }
    expect(wf.jobs.dco.name).toBe('DCO');
  });

  it('queues runs per pull request instead of cancelling a waiting one', () => {
    const wf = workflows.find((w) => w.f === 'cla.yml')?.wf;
    expect(wf.concurrency).toMatchObject({ 'cancel-in-progress': false, queue: 'max' });
    expect(wf.concurrency.group).toContain('pull_request.number');
  });
});
