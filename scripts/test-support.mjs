// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

// Helpers for the shell-script tests (check-dco.test.mjs, release-package.test.mjs): throwaway git
// repositories that ignore the developer's own git configuration, and a synchronous process runner.

import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

/** Environment for git in a throwaway repository: no global or system configuration, no signing. */
export function gitEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LC_ALL: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  };
}

/** Runs a command to completion. Never throws on a non-zero exit; returns status, stdout, stderr. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs git in `cwd` and returns its trimmed stdout; a failure throws with git's message. */
export function git(cwd, args, env = {}) {
  const result = run('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    env: gitEnv(env),
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** The directory that holds the `node` binary running the tests, so scripts find the same one. */
export const NODE_DIR = dirname(process.execPath);
