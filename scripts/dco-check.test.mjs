// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { NO_PERSON, dcoProblem } from './dco-check.mjs';

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
      'dev',
      false,
    ],
    [
      'signed off by the committer',
      { message: 'feat: x\n\nSigned-off-by: Committer <committer@example.org>' },
      'dev',
      false,
    ],
    ['no sign-off', { message: 'feat: x' }, 'dev', true],
    [
      'sign-off with another e-mail',
      { message: 'feat: x\n\nSigned-off-by: Dev <other@example.org>' },
      'dev',
      true,
    ],
    [
      'sign-off inside a sentence',
      { message: 'feat: x, see Signed-off-by: Dev <dev@example.org>' },
      'dev',
      true,
    ],
    ['merge commit', { message: 'Merge branch main', parents: 2 }, 'dev', false],
    [
      'dependabot commit in a dependabot pull request',
      { message: 'chore(deps): bump', login: 'dependabot[bot]' },
      'dependabot[bot]',
      false,
    ],
    [
      'human commit without sign-off in a dependabot pull request',
      { message: 'feat: x', login: 'dev' },
      'dependabot[bot]',
      true,
    ],
    [
      'forged dependabot commit in a pull request of a person',
      { message: 'feat: x', login: 'dependabot[bot]' },
      'dev',
      true,
    ],
    [
      'sign-off with the address of web commits',
      {
        message: `feat: x\n\nSigned-off-by: Anyone <${NO_PERSON}>`,
        email: NO_PERSON,
      },
      'dev',
      true,
    ],
  ])('%s', (_name, input, prAuthor, fails) => {
    const problem = dcoProblem(commit(input), prAuthor);
    if (fails) expect(problem).toContain('0123456789ab: no "Signed-off-by:"');
    else expect(problem).toBeNull();
  });
});
