// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { dcoProblem } from './dco-check.mjs';

const commit = ({ message, email = 'dev@example.org', parents = 1, login = 'dev' }) => ({
  sha: '0123456789abcdef',
  author: { login },
  parents: Array.from({ length: parents }, () => ({})),
  commit: {
    message,
    author: { email },
    committer: { email: 'committer@example.org' },
  },
});

describe('dcoProblem', () => {
  it.each([
    [
      'signed off by the author',
      { message: 'feat: x\n\nSigned-off-by: Dev <DEV@example.org>' },
      false,
    ],
    [
      'signed off by the committer',
      { message: 'feat: x\n\nSigned-off-by: Committer <committer@example.org>' },
      false,
    ],
    ['no sign-off', { message: 'feat: x' }, true],
    [
      'sign-off with another e-mail',
      { message: 'feat: x\n\nSigned-off-by: Dev <other@example.org>' },
      true,
    ],
    [
      'sign-off inside a sentence',
      { message: 'feat: x, see Signed-off-by: Dev <dev@example.org>' },
      true,
    ],
    ['merge commit', { message: 'Merge branch main', parents: 2 }, false],
    [
      'dependabot pull request',
      { message: 'chore(deps): bump', prAuthor: 'dependabot[bot]' },
      false,
    ],
    [
      'forged dependabot commit in a pull request of a person',
      { message: 'feat: x', login: 'dependabot[bot]', prAuthor: 'dev' },
      true,
    ],
  ])('%s', (_name, { prAuthor = 'dev', ...input }, fails) => {
    const problem = dcoProblem(commit(input), prAuthor);
    if (fails) expect(problem).toContain('0123456789ab: no "Signed-off-by:"');
    else expect(problem).toBeNull();
  });
});
