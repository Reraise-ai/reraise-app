// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { GitHubApiError, createGitHubApi } from './lib.mjs';

const answer = (status, body) => ({ ok: status < 300, status, json: async () => body });
const items = (n) => Array.from({ length: n }, (_, i) => ({ i }));

describe('createGitHubApi', () => {
  it('throws on every non-2xx answer, so a failure never reads as an empty result', async () => {
    for (const status of [404, 422, 500]) {
      const api = createGitHubApi({
        token: 't',
        repo: 'o/r',
        fetchImpl: async () => answer(status),
      });
      await expect(api.list('/pulls/1/files')).rejects.toBeInstanceOf(GitHubApiError);
      await expect(api.request('GET', '/pulls/1')).rejects.toMatchObject({ status });
    }
  });

  it('reads pages until a short page: 100 + 3 items are 2 pages', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      return answer(200, urls.length === 1 ? items(100) : items(3));
    };
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl });
    expect(await api.list('/pulls/1/files')).toHaveLength(103);
    expect(urls).toEqual([
      'https://api.github.com/repos/o/r/pulls/1/files?per_page=100&page=1',
      'https://api.github.com/repos/o/r/pulls/1/files?per_page=100&page=2',
    ]);
  });

  it('throws when a page is not a list or the page limit is reached', async () => {
    const notList = createGitHubApi({
      token: 't',
      repo: 'o/r',
      fetchImpl: async () => answer(200, { message: 'x' }),
    });
    await expect(notList.list('/pulls/1/files')).rejects.toThrow(/not a list/);
    const endless = createGitHubApi({
      token: 't',
      repo: 'o/r',
      fetchImpl: async () => answer(200, items(100)),
    });
    await expect(endless.list('/pulls/1/commits', 3)).rejects.toThrow(/more than 3 pages/);
  });

  it('throws on a timeout', async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl, timeoutMs: 10 });
    await expect(api.list('/pulls/1/files')).rejects.toThrow();
  });
});
