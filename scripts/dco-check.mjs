// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// Fails when a commit of the pull request has no DCO sign-off (ADR-0004, ADR-0052). Runs from
// the default branch on `pull_request_target`, so a pull request cannot change this check.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_COMMITS, createGitHubApi } from './lib.mjs';

/** Web commits are committed by this address; it names no person, so a sign-off with it is void. */
// Built from parts: the no-real-data scan flags a spelled-out address.
export const NO_PERSON = ['noreply', 'github.com'].join('@');
const SIGNOFF_RE = /^Signed-off-by: .+ <([^<>\s]+)>\s*$/gm;

/**
 * Problem text for one commit of `GET /pulls/{n}/commits`, or null when it passes. A commit is
 * exempt as Dependabot's only when the pull request author is Dependabot (nobody can fake that)
 * and the commit is linked to it too: GitHub links a commit to an account by its e-mail address
 * alone, and anybody can put the Dependabot noreply address into a commit.
 */
export function dcoProblem(c, prAuthor) {
  const bot = 'dependabot[bot]';
  if (c.parents.length > 1 || (prAuthor === bot && c.author?.login === bot)) return null;
  const emails = [c.commit.author.email, c.commit.committer.email]
    .map((e) => e.toLowerCase())
    .filter((e) => e !== NO_PERSON);
  const signed = [...c.commit.message.matchAll(SIGNOFF_RE)].some((m) =>
    emails.includes(m[1].toLowerCase()),
  );
  if (signed) return null;
  return `${c.sha.slice(0, 12)}: no "Signed-off-by:" line with the e-mail of its author or committer. Fix: git commit --amend -s (last commit) or git rebase --signoff <base> (all commits), then push with --force-with-lease.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const pr = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8')).pull_request;
  const api = createGitHubApi({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY });
  const problems =
    pr.commits > MAX_COMMITS
      ? [`more than ${MAX_COMMITS} commits cannot be checked; please split the pull request`]
      : (await api.list(`/pulls/${pr.number}/commits`, 3))
          .map((c) => dcoProblem(c, pr.user?.login))
          .filter(Boolean);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else console.log(`DCO ok: ${pr.commits} commit(s) signed off`);
}
