// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.vitepress',
]);

/** Recursively list files under `dir`, skipping build/vendor directories. */
export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export class GitHubApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** GitHub lists at most 250 commits of a pull request; beyond that the CI scripts fail closed. */
export const MAX_COMMITS = 250;

/**
 * Minimal GitHub REST client for CI scripts. Every non-2xx answer, every timeout and every page
 * that is not a list throws, so a caller can never mistake a failed call for an empty result.
 * The token is never printed.
 * @param {{ token?: string, repo?: string, timeoutMs?: number,
 *   fetchImpl?: (url: string, init: any) => Promise<any> }} options
 */
export function createGitHubApi({ token, repo, fetchImpl = fetch, timeoutMs = 20_000 }) {
  /** @param {string} method @param {string} route @param {unknown} [body] @returns {Promise<any>} */
  async function request(method, route, body) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${route}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok)
      throw new GitHubApiError(`GitHub API ${method} ${route}: ${res.status}`, res.status);
    return res.status === 204 ? null : res.json();
  }

  /** All items of a paginated list, 100 per page; more than `maxPages` full pages throws. */
  async function list(route, maxPages = 30) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const items = await request('GET', `${route}?per_page=100&page=${page}`);
      if (!Array.isArray(items)) throw new GitHubApiError(`GitHub API GET ${route}: not a list`, 0);
      out.push(...items);
      if (items.length < 100) return out;
    }
    throw new GitHubApiError(`GitHub API GET ${route}: more than ${maxPages} pages`, 0);
  }

  return { request, list };
}
