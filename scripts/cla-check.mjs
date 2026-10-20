// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// Sets the commit status `CLA` on a pull request (ADR-0052). Runs from the default branch on
// `pull_request_target` and `issue_comment`; it never checks out or runs pull request code.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGPL, expectedLicense } from './check-spdx.mjs';
import { GitHubApiError, MAX_COMMITS, createGitHubApi } from './lib.mjs';

export const CONTEXT = 'CLA';
export const MARKER = '<!-- cla-check -->';
export const SENTENCE = 'I have read the Reraise Individual CLA v1.0 and I agree to it.';
export const SIGNATURE_BRANCH = 'cla-signatures';
export const SIGNATURE_FILE = 'signatures/individual-1.0.json';
export const INDIVIDUAL_CLA = 'legal/cla/CLA-INDIVIDUAL.md';
export const ENTITIES_DIR = 'legal/cla/entities';
/** GitHub lists at most 3000 files of a pull request; beyond that we fail closed. */
export const MAX_FILES = 3000;
/** Pull request authors and commenters that need no signature and cannot sign. */
export const EXEMPT = new Set(['dependabot[bot]', 'github-actions[bot]']);
/**
 * Agent identities with a GitHub account of type User (the commit e-mail of Claude Code links
 * to the account `claude`, id 81847). As commit authors they, and every account of
 * type Bot, count as the pull request author's responsibility (ADR-0052 rule 6).
 */
export const AGENT_ACCOUNTS = new Set(['claude']);
/** Required fields of an entity record in legal/cla/entities/*.json. */
export const ENTITY_FIELDS = ['entity', 'signatory', 'title', 'date', 'claVersion', 'contributors'];
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

/** True for a bot or agent account; its commits are attributed to the pull request author. */
export function isAgent(u) {
  return u.type === 'Bot' || u.login.endsWith('[bot]') || AGENT_ACCOUNTS.has(u.login);
}

/**
 * The pull request author (unless exempt) and every commit author with a human GitHub account.
 * Commits without an account or by a bot or agent account need no signer of their own: they
 * count as the pull request author's, who must have signed anyway.
 */
export function requiredSigners(pr, commits) {
  const people = new Map();
  if (!EXEMPT.has(pr.user.login)) people.set(pr.user.id, { login: pr.user.login, id: pr.user.id });
  for (const u of commits.map((c) => c.author)) {
    if (u && !EXEMPT.has(u.login) && !isAgent(u)) people.set(u.id, { login: u.login, id: u.id });
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

/** True when GitHub's lists of the pull request cannot be complete; we then fail closed. */
const tooLarge = (pr, files) =>
  pr.changed_files > MAX_FILES || files.length > MAX_FILES || pr.commits > MAX_COMMITS;

/** The CLA status of a pull request: `{ state, description, missing }`. */
export function evaluate({ pr, files, commits, signatures, entities, agpl = touchesAgpl(files) }) {
  if (tooLarge(pr, files)) {
    const description = 'Too many files or commits to check; please split the pull request';
    return { state: 'error', description, missing: [] };
  }
  if (!agpl) {
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

export const SIGNED_BODY = `${MARKER}
**CLA signed.** All contributors to this pull request have signed the CLA. Thank you.
`;

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

/** Entity records of the checked-out default branch; a record missing a field throws. */
export function readEntities(root) {
  const dir = path.join(root, ENTITIES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const record = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const missing = ENTITY_FIELDS.filter((k) => !record[k]);
      if (!Array.isArray(record.contributors)) missing.push('contributors (a list)');
      if (missing.length > 0)
        throw new Error(`${ENTITIES_DIR}/${f}: missing ${missing.join(', ')}`);
      return record;
    });
}

/**
 * The signature store on the branch cla-signatures. The Contents API returns no content above
 * 1 MB (about 4000 signatures); the run then ends with `error`, never green.
 */
async function readSignatures(api) {
  try {
    const file = await api.request('GET', `/contents/${SIGNATURE_FILE}?ref=${SIGNATURE_BRANCH}`);
    const store = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    return { store, sha: file.sha };
  } catch (err) {
    if (!(err instanceof GitHubApiError && err.status === 404)) throw err;
    throw new Error(
      `no ${SIGNATURE_FILE} on branch ${SIGNATURE_BRANCH}; a maintainer must create it`,
    );
  }
}

/** A comment counts as a signature only as first written, not after an edit. */
const unedited = (c) => !c.updated_at || c.updated_at === c.created_at;

/**
 * Adds every signer of `signings` not yet in the store and returns the store as written, so the
 * status uses exactly this state (no second, possibly cached read). Retries on 409.
 */
async function recordSignatures(api, signings) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { store, sha } = await readSignatures(api);
    const next = signings.reduce((s, signing) => addSignature(s, signing) ?? s, store);
    if (next === store) return store;
    const added = next.signatures.slice(store.signatures.length).map((s) => s.login);
    try {
      await api.request('PUT', `/contents/${SIGNATURE_FILE}`, {
        message: `chore(cla): record signature of ${mentions(added)}`,
        content: Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString('base64'),
        sha,
        branch: SIGNATURE_BRANCH,
      });
      return next;
    } catch (err) {
      if (!(err instanceof GitHubApiError && err.status === 409)) throw err;
    }
  }
  throw new Error('signature store kept changing; try "recheck"');
}

/** One bot comment per pull request, found by its marker and edited instead of repeated. */
async function upsertComment(api, number, comments, body, create = true) {
  const own = comments.find((c) => c.user?.login === BOT && c.body?.includes(MARKER));
  if (own?.body === body) return;
  if (own) await api.request('PATCH', `/issues/comments/${own.id}`, { body });
  else if (create) await api.request('POST', `/issues/${number}/comments`, { body });
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
    const [files, commits, comments] = await Promise.all([
      api.list(`/pulls/${pr.number}/files`),
      api.list(`/pulls/${pr.number}/commits`, 3),
      api.list(`/issues/${pr.number}/comments`),
    ]);
    // Every run records all signing comments of the pull request, so a run that GitHub dropped
    // or that failed is healed by the next one. The event's own comment is added in case the
    // list is served from a cache.
    const signings = [...comments, eventName === 'issue_comment' ? event.comment : null]
      .filter(
        (c) => c?.user && !EXEMPT.has(c.user.login) && unedited(c) && isSigningComment(c.body),
      )
      .map((comment) => ({ comment, pullRequest: pr.number, agreementSha256 }));
    const agpl = touchesAgpl(files);
    const store = agpl || signings.length > 0 ? await recordSignatures(api, signings) : null;
    const signatures = store?.signatures ?? [];
    const records = typeof entities === 'function' ? entities() : entities;
    const result = evaluate({ pr, files, commits, signatures, entities: records, agpl });
    await setStatus(result);
    if (result.state === 'failure')
      await upsertComment(api, pr.number, comments, commentBody(result.missing));
    if (result.state === 'success' && agpl)
      await upsertComment(api, pr.number, comments, SIGNED_BODY, false);
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
    entities: () => readEntities(root),
    agreementSha256: createHash('sha256')
      .update(readFileSync(path.join(root, INDIVIDUAL_CLA)))
      .digest('hex'),
    targetUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  });
  console.log(result ? `CLA ${result.state}: ${result.description}` : 'CLA: nothing to do');
}
