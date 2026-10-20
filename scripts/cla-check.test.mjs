// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import {
  MARKER,
  SIGNATURE_FILE,
  evaluate,
  isSigningComment,
  readEntities,
  run,
} from './cla-check.mjs';
import { GitHubApiError } from './lib.mjs';
import { makeTree } from './test-helpers.mjs';

const alice = { login: 'alice', id: 1 };
const bob = { login: 'bob', id: 2 };
const dependabot = { login: 'dependabot[bot]', id: 49699333 };
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
  it('reads the json records and ignores other files', () => {
    const root = makeTree({
      'legal/cla/entities/acme.json': '{"entity":"Acme","contributors":["bob"]}',
      'legal/cla/entities/.gitkeep': '',
    });
    expect(readEntities(root)).toEqual([{ entity: 'Acme', contributors: ['bob'] }]);
    expect(readEntities(makeTree({}))).toEqual([]);
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
