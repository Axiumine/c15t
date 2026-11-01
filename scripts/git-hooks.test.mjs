// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasSignoff, installHooks, isSignoffLine, main, run } from './git-hooks.mjs';

const script = fileURLToPath(new URL('./git-hooks.mjs', import.meta.url));

// Fixture helpers: every path is inside a temporary directory that the calling test created.
function put(file, text) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixture in a temporary directory
  writeFileSync(file, text);
}
function mkdirp(dir) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixture in a temporary directory
  mkdirSync(dir, { recursive: true });
}
/** The value for `key` in a plain object used as a lookup table, or `fallback`. */
function lookup(table, key, fallback) {
  return Object.hasOwn(table, key) ? Reflect.get(table, key) : fallback;
}

test('a sign-off line is "Signed-off-by: " + a name + an address in angle brackets that ends the line', () => {
  assert.equal(isSignoffLine('Signed-off-by: Ada Lovelace <ada@example.org>'), true);
  assert.equal(isSignoffLine('Signed-off-by: A <b <c@d.e>'), true);
  for (const line of [
    'signed-off-by: Ada <ada@example.org>',
    'Signed-off-by: Ada <ada@example.org> ',
    'Signed-off-by: Ada Lovelace',
    'Signed-off-by: <ada@example.org>',
    'Signed-off-by:  <ada@example.org>',
    'Signed-off-by: Ada <adaexample.org>',
    'Signed-off-by: Ada <@example.org>',
    'Signed-off-by: Ada <ada@>',
    'Signed-off-by: Ada <a da@example.org>',
    'Signed-off-by: Ada <a>b@c.d>',
    '',
  ]) {
    assert.equal(isSignoffLine(line), false, line);
  }
});

test('a commit message needs a Signed-off-by line with a name and an email', () => {
  assert.equal(hasSignoff('feat: x\n\nSigned-off-by: Ada Lovelace <ada@example.org>\n'), true);
  assert.equal(
    hasSignoff(
      'feat: x\n\nbody\n\nSigned-off-by: Ada <ada@example.org>\nCo-Authored-By: B <b@c.d>',
    ),
    true,
  );
  assert.equal(hasSignoff('feat: x\n'), false);
  assert.equal(hasSignoff('feat: x\n\nSigned-off-by: Ada Lovelace\n'), false);
  assert.equal(hasSignoff('feat: x\n\nSigned-off-by: <ada@example.org>\n'), false);
  assert.equal(hasSignoff('feat: x\n\nSigned-off-by: Ada <ada@example.org> trailing\n'), false);
});

test('comment lines of the message file do not count, merges and autosquash commits are exempt', () => {
  assert.equal(hasSignoff('feat: x\n# Signed-off-by: Ada <ada@example.org>\n'), false);
  assert.equal(hasSignoff("Merge branch 'a' into b\n"), true);
  assert.equal(hasSignoff('fixup! feat: x\n'), true);
  assert.equal(hasSignoff('squash! feat: x\n'), true);
  assert.equal(hasSignoff('amend! feat: x\n'), true);
  assert.equal(hasSignoff('Merged nothing\n'), false);
});

test('run returns the exit status and trimmed output, and null when the command cannot start', () => {
  const ok = run(process.execPath, ['-e', 'console.log("  hi  ")']);
  assert.deepEqual(ok, { status: 0, stdout: 'hi' });
  assert.equal(run(process.execPath, ['-e', 'process.exit(3)']).status, 3);
  assert.deepEqual(run(join(tmpdir(), 'c15t-no-such-command-xyz'), []), {
    status: null,
    stdout: '',
  });
});

/** installHooks with a scripted `exec`: `answers` maps "command arg ..." to { status, stdout }. */
function install(answers, { env = {}, withLefthook = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'c15t-hooks-'));
  try {
    if (withLefthook) {
      mkdirp(join(root, 'node_modules', '.bin'));
      put(join(root, 'node_modules', '.bin', 'lefthook'), '');
    }
    const calls = [];
    const exec = (command, args, options) => {
      const key = [
        command === join(root, 'node_modules', '.bin', 'lefthook') ? 'lefthook' : command,
        ...args,
      ].join(' ');
      calls.push({ key, cwd: options.cwd === root });
      return lookup(answers, key, { status: 1, stdout: '' });
    };
    return { message: installHooks({ env, root, exec }), calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const inside = { 'git rev-parse --is-inside-work-tree': { status: 0, stdout: 'true' } };
const noHooksPath = { 'git config --get core.hooksPath': { status: 1, stdout: '' } };

test('install does nothing in CI or when asked to skip, and does not even look at git', () => {
  for (const env of [{ CI: 'true' }, { C15T_SKIP_HOOKS: '1' }]) {
    const { message, calls } = install({}, { env });
    assert.match(message, /skipped \(CI or C15T_SKIP_HOOKS=1\)/);
    assert.deepEqual(calls, []);
  }
  assert.match(
    install(
      { ...inside, ...noHooksPath, 'lefthook install': { status: 0, stdout: '' } },
      { env: { C15T_SKIP_HOOKS: '0' } },
    ).message,
    /installed/,
  );
});

test('install skips a tree that is not a git checkout', () => {
  assert.match(install({}).message, /not a git checkout/);
  assert.match(
    install({ 'git rev-parse --is-inside-work-tree': { status: 0, stdout: 'false' } }).message,
    /not a git checkout/,
  );
});

test('install leaves a clone alone when core.hooksPath is set', () => {
  const { message } = install({
    ...inside,
    'git config --get core.hooksPath': { status: 0, stdout: '.githooks' },
  });
  assert.match(message, /core\.hooksPath is set to \.githooks/);
});

test('install skips when the lefthook binary is missing', () => {
  assert.match(
    install({ ...inside, ...noHooksPath }, { withLefthook: false }).message,
    /lefthook is not installed/,
  );
});

test('install runs lefthook in the repository root and reports success or failure', () => {
  const good = install({
    ...inside,
    ...noHooksPath,
    'lefthook install': { status: 0, stdout: '' },
  });
  assert.match(good.message, /installed/);
  assert.deepEqual(
    good.calls.map((call) => call.key),
    ['git rev-parse --is-inside-work-tree', 'git config --get core.hooksPath', 'lefthook install'],
  );
  assert.ok(good.calls.every((call) => call.cwd));
  assert.match(
    install({ ...inside, ...noHooksPath, 'lefthook install': { status: 2, stdout: '' } }).message,
    /install failed/,
  );
});

test('installHooks has working defaults: it reports something for the real checkout and never throws', () => {
  assert.match(installHooks({ env: { CI: 'true' } }), /^git hooks: /);
});

/** main() with captured output; `files` maps a path to the message file's text. */
function cli(argv, files = {}) {
  const out = [];
  const err = [];
  const status = main(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    read: (file) => lookup(files, file, ''),
    install: () => 'git hooks: stand-in',
  });
  return { status, out, err };
}

test('main commit-msg passes a signed message and rejects an unsigned one with the fix', () => {
  const files = { good: 'x\n\nSigned-off-by: Ada <ada@example.org>\n', bad: 'x\n' };
  assert.deepEqual(cli(['commit-msg', 'good'], files), { status: 0, out: [], err: [] });
  const bad = cli(['commit-msg', 'bad'], files);
  assert.equal(bad.status, 1);
  assert.match(bad.err.join('\n'), /Signed-off-by/);
  assert.match(bad.err.join('\n'), /git commit -s --amend/);
});

test('main install prints the outcome and exits 0 even if nothing was installed', () => {
  assert.deepEqual(cli(['install']), { status: 0, out: ['git hooks: stand-in'], err: [] });
});

test('main prints the usage for anything else', () => {
  for (const argv of [[], ['commit-msg'], ['nope']]) {
    const result = cli(argv);
    assert.equal(result.status, 2);
    assert.match(result.err.join(''), /usage/);
  }
});

test('the command line entry point exits with the status of main', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c15t-hooks-cli-'));
  try {
    const message = join(dir, 'COMMIT_EDITMSG');
    put(message, 'feat: x\n');
    const bad = run(process.execPath, [script, 'commit-msg', message]);
    assert.equal(bad.status, 1);
    put(message, 'feat: x\n\nSigned-off-by: Ada <ada@example.org>\n');
    assert.equal(run(process.execPath, [script, 'commit-msg', message]).status, 0);
    assert.equal(run(process.execPath, [script]).status, 2);
    assert.equal(
      run(process.execPath, [script, 'install'], {
        cwd: dir,
        env: { PATH: process.env.PATH, CI: 'true' },
      }).status,
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
