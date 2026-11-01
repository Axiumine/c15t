// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { git, gitEnv, run } from './test-support.mjs';

/*
 * scripts/check-dco.sh against throwaway repositories: a base commit, then one candidate commit
 * with the author, committer and message under test. The bot exemption must hold for the two known
 * bot logins with their GitHub noreply address, and for nothing else.
 */

const SCRIPT = resolve(import.meta.dirname, 'check-dco.sh');
// The script is copied next to the throwaway repository's history and run by its relative name, as
// release-package.test.mjs does, so no absolute path of this checkout reaches the `bash` command.
const SCRIPT_IN_REPO = 'check-dco.sh';
const DEPENDABOT = '49699333+dependabot[bot]@users.noreply.github.com';
const ACTIONS = '41898282+github-actions[bot]@users.noreply.github.com';

let root;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-dco-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function commit(repo, { name, email, committerEmail = email, message }) {
  git(repo, ['commit', '--allow-empty', '-m', message], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: committerEmail,
  });
  return git(repo, ['rev-parse', 'HEAD']);
}

const human = { name: 'Una Dev', email: 'una@example.com' };

/** A repository with a signed-off base commit and the given candidate commits on top. */
function scenario(...candidates) {
  const repo = join(root, `repo-${counter++}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  mkdirSync(repo);
  copyFileSync(SCRIPT, join(repo, SCRIPT_IN_REPO));
  git(repo, ['init', '-q', '-b', 'main']);
  const base = commit(repo, {
    ...human,
    message: `base\n\nSigned-off-by: Una Dev <${human.email}>`,
  });
  for (const candidate of candidates) commit(repo, candidate);
  return { repo, base, head: git(repo, ['rev-parse', 'HEAD']) };
}

function check({ repo, base, head }) {
  return run('bash', [SCRIPT_IN_REPO], {
    cwd: repo,
    env: gitEnv({ BASE_SHA: base, HEAD_SHA: head }),
  });
}

const signed = (email) => `change\n\nSigned-off-by: Una Dev <${email}>`;

describe('commits that need a sign-off', () => {
  test('a signed-off commit passes', () => {
    const result = check(scenario({ ...human, message: signed(human.email) }));
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('All commits are signed off');
  });

  test('an unsigned commit fails and is named', () => {
    const result = check(scenario({ ...human, message: 'no trailer here' }));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Missing or mismatched Signed-off-by');
    expect(result.stdout).toContain('no trailer here');
  });

  test('a sign-off by somebody else fails', () => {
    const result = check(scenario({ ...human, message: signed('other@example.com') }));
    expect(result.status).toBe(1);
  });

  test("a sign-off with the committer's address passes, ignoring case", () => {
    const result = check(
      scenario({
        name: 'Una Dev',
        email: 'una@example.com',
        committerEmail: 'Committer@Example.com',
        message: signed('committer@example.com'),
      }),
    );
    expect(result.status, result.stdout).toBe(0);
  });

  test('one unsigned commit among signed ones fails the whole range', () => {
    const result = check(
      scenario(
        { ...human, message: signed(human.email) },
        { ...human, message: 'unsigned middle' },
        { ...human, message: signed(human.email) },
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('unsigned middle');
  });

  test('BASE_SHA and HEAD_SHA are required', () => {
    const { repo } = scenario();
    const result = run('bash', [SCRIPT_IN_REPO], { cwd: repo, env: gitEnv() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('BASE_SHA is required');
  });
});

describe('the bot exemption', () => {
  test.each([
    ['dependabot[bot]', DEPENDABOT],
    ['github-actions[bot]', ACTIONS],
    ['dependabot[bot]', DEPENDABOT.toUpperCase()],
  ])('%s with its noreply address needs no sign-off', (name, email) => {
    const result = check(scenario({ name, email, message: 'chore(deps): bump something' }));
    expect(result.status, result.stdout).toBe(0);
  });

  test.each([
    ['any other name ending in [bot]', 'evil[bot]', 'evil@example.com'],
    ['a [bot] name with the dependabot address', 'Attacker[bot]', DEPENDABOT],
    ['a name that only contains dependabot[bot]', 'not-dependabot[bot]', DEPENDABOT],
    [
      'renovate[bot], which is not on the list',
      'renovate[bot]',
      '29139614+renovate[bot]@users.noreply.github.com',
    ],
    ['dependabot[bot] with a foreign address', 'dependabot[bot]', 'attacker@example.com'],
    ['dependabot[bot] with the other bot address', 'dependabot[bot]', ACTIONS],
    ['github-actions[bot] with the other bot address', 'github-actions[bot]', DEPENDABOT],
    [
      'github-actions[bot] with a lookalike address',
      'github-actions[bot]',
      'github-actions[bot]@users.noreply.github.com',
    ],
    ['a human with the dependabot address', 'Una Dev', DEPENDABOT],
  ])('%s still needs a sign-off', (_label, name, email) => {
    const result = check(scenario({ name, email, message: 'looks like a bot commit' }));
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('Missing or mismatched Signed-off-by');
  });

  test('a bot commit does not excuse the human commit next to it', () => {
    const result = check(
      scenario(
        { name: 'dependabot[bot]', email: DEPENDABOT, message: 'bump' },
        { ...human, message: 'human commit without trailer' },
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('human commit without trailer');
    expect(result.stdout).not.toContain('bump');
  });
});
