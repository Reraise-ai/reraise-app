// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// Sets the commit status `CLA` on a pull request (ADR-0052). Runs from the default branch on
// `pull_request_target` and `issue_comment`; it never checks out or runs pull request code.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGPL, expectedLicense } from './check-spdx.mjs';
import { GitHubApiError, createGitHubApi } from './lib.mjs';

export const CONTEXT = 'CLA';
export const MARKER = '<!-- cla-check -->';
export const SENTENCE = 'I have read the Reraise Individual CLA v1.0 and I agree to it.';
export const SIGNATURE_BRANCH = 'cla-signatures';
export const SIGNATURE_FILE = 'signatures/individual-1.0.json';
export const INDIVIDUAL_CLA = 'legal/cla/CLA-INDIVIDUAL.md';
export const ENTITIES_DIR = 'legal/cla/entities';
/** GitHub lists at most 3000 files and 250 commits of a pull request; beyond that we fail closed. */
export const MAX_FILES = 3000;
export const MAX_COMMITS = 250;
export const EXEMPT = new Set(['dependabot[bot]', 'github-actions[bot]']);
const BOT = 'github-actions[bot]';
const BLOB = 'https://github.com/Reraise-ai/reraise-app/blob/main';

const mentions = (/** @type {string[]} */ logins) => logins.map((l) => `@${l}`).join(', ');

/** True when a changed file, or the file it was renamed from, lies in an AGPL directory. */
export function touchesAgpl(files) {
  return files.some((f) =>
    [f.filename, f.previous_filename].some((p) => p !== undefined && expectedLicense(p) === AGPL),
  );
}

/** True when a comment is exactly the signing sentence (trimmed, any case, final dot optional). */
export function isSigningComment(body) {
  const norm = (/** @type {string} */ s) => s.trim().replace(/\.$/, '').toLowerCase();
  return norm(body ?? '') === norm(SENTENCE);
}

/** The pull request author and every commit author with a GitHub account, bots excepted. */
export function requiredSigners(pr, commits) {
  const people = new Map();
  for (const u of [pr.user, ...commits.map((c) => c.author)]) {
    if (u && !EXEMPT.has(u.login)) people.set(u.id, { login: u.login, id: u.id });
  }
  return [...people.values()];
}

/** Individuals match by numeric account id (logins can be renamed), entity members by login. */
export function hasSigned(person, signatures, entities) {
  const login = person.login.toLowerCase();
  return (
    signatures.some((s) => s.id === person.id) ||
    entities.some((e) =>
      e.contributors.some((/** @type {string} */ c) => c.toLowerCase() === login),
    )
  );
}

/** The CLA status of a pull request: `{ state, description, missing }`. */
export function evaluate({ pr, files, commits, signatures, entities }) {
  if (pr.changed_files > MAX_FILES || files.length > MAX_FILES || pr.commits > MAX_COMMITS) {
    const description = 'Too many files or commits to check; please split the pull request';
    return { state: 'error', description, missing: [] };
  }
  if (!touchesAgpl(files)) {
    return { state: 'success', description: 'No AGPL path touched, no CLA needed', missing: [] };
  }
  const missing = requiredSigners(pr, commits)
    .filter((p) => !hasSigned(p, signatures, entities))
    .map((p) => p.login);
  if (missing.length === 0) {
    return { state: 'success', description: 'All contributors have signed', missing };
  }
  const description = `CLA signature missing: ${mentions(missing)}`;
  return { state: 'failure', description: description.slice(0, 140), missing };
}

/** The signature store with the commenter added, or null when the commenter has signed before. */
export function addSignature(store, { comment, pullRequest, agreementSha256 }) {
  const { login, id } = comment.user;
  if (store.signatures.some((s) => s.id === id)) return null;
  const entry = {
    login,
    id,
    signedAt: comment.created_at,
    pullRequest,
    commentId: comment.id,
    commentUrl: comment.html_url,
    agreementVersion: '1.0',
    agreementSha256,
  };
  return { ...store, signatures: [...store.signatures, entry] };
}

export function commentBody(missing) {
  return `${MARKER}
**CLA required.** This pull request changes files in an AGPL-3.0-or-later part of the project
(\`apps/board\`, \`services/api\`, \`packages/mcp-server\` or \`e2e\`). Missing signature: ${mentions(missing)}.

Please read the [Individual CLA](${BLOB}/legal/cla/CLA-INDIVIDUAL.md)
and sign it once by replying to this pull request with exactly this sentence:

\`${SENTENCE}\`

Your employer owns what you write? Your employer signs the Entity CLA instead, see
[CONTRIBUTING.md](${BLOB}/CONTRIBUTING.md#signing-the-cla).
Changes that only touch the Apache-2.0 parts need no CLA, only the DCO sign-off.
`;
}

/** Entity records (`legal/cla/entities/*.json`) of the checked-out default branch. */
export function readEntities(root) {
  const dir = path.join(root, ENTITIES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

async function readSignatures(api) {
  const file = await api.request('GET', `/contents/${SIGNATURE_FILE}?ref=${SIGNATURE_BRANCH}`);
  return { store: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), sha: file.sha };
}

/** Adds the commenter to the store; retries when another run wrote in between (409). */
async function recordSignature(api, signing) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { store, sha } = await readSignatures(api);
    const next = addSignature(store, signing);
    if (next === null) return;
    const content = Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString('base64');
    const message = `chore(cla): record signature of @${signing.comment.user.login}`;
    try {
      await api.request('PUT', `/contents/${SIGNATURE_FILE}`, {
        message,
        content,
        sha,
        branch: SIGNATURE_BRANCH,
      });
      return;
    } catch (err) {
      if (!(err instanceof GitHubApiError && err.status === 409)) throw err;
    }
  }
  throw new Error('signature store kept changing; try "recheck"');
}

/** One bot comment per pull request, found by its marker and edited instead of repeated. */
async function upsertComment(api, number, body) {
  const comments = await api.list(`/issues/${number}/comments`);
  const own = comments.find((c) => c.user?.login === BOT && c.body?.includes(MARKER));
  if (own) await api.request('PATCH', `/issues/comments/${own.id}`, { body });
  else await api.request('POST', `/issues/${number}/comments`, { body });
}

/** Handles one workflow event. Returns the status set, or null when there is nothing to do. */
export async function run({ eventName, event, api, entities, agreementSha256, targetUrl }) {
  if (eventName === 'issue_comment' && !event.issue.pull_request) return null;
  const pr =
    eventName === 'issue_comment'
      ? await api.request('GET', `/pulls/${event.issue.number}`)
      : event.pull_request;
  if (pr.state !== 'open') return null;
  const setStatus = (r) =>
    api.request('POST', `/statuses/${pr.head.sha}`, {
      state: r.state,
      context: CONTEXT,
      description: r.description,
      target_url: targetUrl,
    });
  try {
    const comment = eventName === 'issue_comment' ? event.comment : null;
    if (comment && !EXEMPT.has(comment.user.login) && isSigningComment(comment.body)) {
      await recordSignature(api, { comment, pullRequest: pr.number, agreementSha256 });
    }
    const [files, commits] = await Promise.all([
      api.list(`/pulls/${pr.number}/files`),
      api.list(`/pulls/${pr.number}/commits`, 3),
    ]);
    const signatures = touchesAgpl(files) ? (await readSignatures(api)).store.signatures : [];
    const result = evaluate({ pr, files, commits, signatures, entities });
    await setStatus(result);
    if (result.state === 'failure')
      await upsertComment(api, pr.number, commentBody(result.missing));
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const result = { state: 'error', description: `CLA check failed: ${reason}`.slice(0, 140) };
    await setStatus(result);
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = process.env;
  const result = await run({
    eventName: env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8')),
    api: createGitHubApi({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY }),
    entities: readEntities(root),
    agreementSha256: createHash('sha256')
      .update(readFileSync(path.join(root, INDIVIDUAL_CLA)))
      .digest('hex'),
    targetUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  });
  console.log(result ? `CLA ${result.state}: ${result.description}` : 'CLA: nothing to do');
}
