#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

// Helpers for the Git hooks that lefthook runs (lefthook.yml, docs/quality-gates.md):
//
//   node scripts/git-hooks.mjs commit-msg <message file>   fails unless the commit carries a DCO sign-off
//   node scripts/git-hooks.mjs install                     installs the hooks; never fails, never overrides
//
// `install` runs as the root `postinstall`, so it must not break `yarn install` where there is nothing to
// install: CI, a release tarball or `git archive` source tree (no .git), a clone whose owner points
// `core.hooksPath` somewhere else, or a machine where the optional lefthook binary did not install.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SIGNOFF_PREFIX = 'Signed-off-by: ';
// Merge commits carry no sign-off (scripts/check-dco.sh skips them too). fixup!, squash! and amend! commits
// are folded into another commit by `git rebase --autosquash` before they are pushed.
const EXEMPT_SUBJECT = /^(Merge |fixup! |squash! |amend! )/;

/** True for "Signed-off-by: Name <email>": a name, then an address in angle brackets that ends the line. */
export function isSignoffLine(line) {
  if (!line.startsWith(SIGNOFF_PREFIX) || !line.endsWith('>')) return false;
  const open = line.lastIndexOf(' <');
  if (open < SIGNOFF_PREFIX.length) return false;
  const name = line.slice(SIGNOFF_PREFIX.length, open);
  const email = line.slice(open + 2, -1);
  const at = email.indexOf('@');
  return name.trim() !== '' && at > 0 && at < email.length - 1 && !/[<>\s]/.test(email);
}

/** True when the commit message has a sign-off line (comment lines do not count), or is exempt (see above). */
export function hasSignoff(message) {
  const lines = message.split('\n').filter((line) => !line.startsWith('#'));
  return EXEMPT_SUBJECT.test(lines.join('\n')) || lines.some(isSignoffLine);
}

/** Runs a command; returns its exit status and trimmed stdout (status is null when it cannot start). */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return { status: result.status, stdout: (result.stdout ?? '').trim() };
}

/** Why there is nothing to install here, or null when the hooks should be installed. */
function skipReason({ env, root, exec, lefthook }) {
  if (env['CI'] || env['C15T_SKIP_HOOKS'] === '1') return 'CI or C15T_SKIP_HOOKS=1';
  if (exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root }).stdout !== 'true') {
    return 'not a git checkout';
  }
  const hooksPath = exec('git', ['config', '--get', 'core.hooksPath'], { cwd: root }).stdout;
  if (hooksPath !== '') return `core.hooksPath is set to ${hooksPath}`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the repository root plus a fixed name
  return existsSync(lefthook) ? null : 'lefthook is not installed';
}

/**
 * Installs the lefthook-managed hooks into this clone. Returns a one-line message saying what was done
 * or why nothing was; it only reports problems, so a failed hook install never fails `yarn install`.
 */
export function installHooks({ env = process.env, root = process.cwd(), exec = run } = {}) {
  const lefthook = join(root, 'node_modules', '.bin', 'lefthook');
  const reason = skipReason({ env, root, exec, lefthook });
  if (reason !== null) return `git hooks: skipped (${reason})`;
  const result = exec(lefthook, ['install'], { cwd: root });
  return result.status === 0
    ? 'git hooks: installed (lefthook.yml; skip one run with LEFTHOOK=0 or git --no-verify)'
    : 'git hooks: lefthook install failed; run `yarn lefthook install` to see why';
}

/** Command line entry. Returns the exit status; `io` is injectable for the tests. */
export function main(
  argv,
  io = {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    read: readFileSync,
    install: installHooks,
  },
) {
  const [command, file] = argv;
  if (command === 'install') {
    io.out(io.install());
    return 0;
  }
  if (command === 'commit-msg' && file !== undefined) {
    if (hasSignoff(io.read(file, 'utf8'))) return 0;
    io.err('commit-msg: no "Signed-off-by: Name <email>" line (Developer Certificate of Origin).');
    io.err('Amend with `git commit -s --amend`, or commit with `git commit -s`.');
    return 1;
  }
  io.err('usage: git-hooks.mjs install | commit-msg <message file>');
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
