// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { git, gitEnv, NODE_DIR, run } from './test-support.mjs';

/*
 * scripts/release-package.sh in a throwaway repository with fake build output and a fake
 * `cyclonedx-yarn`. It checks the part that is easy to lose silently: the dashboard-web tarball
 * must carry THIRD-PARTY-NOTICES.md (the bundle is minified and has no notices of its own), and
 * the tarball is what SHA256SUMS covers.
 */

const SCRIPT = resolve(import.meta.dirname, 'release-package.sh');
const NOTICES = 'apps/dashboard-web/dist/THIRD-PARTY-NOTICES.md';
const NOTICES_TEXT = [
  '# Licenses',
  '',
  'The app bundles dependencies which contain the following licenses:',
  '',
  '## react - 19.3.1 (MIT)',
  '',
  'MIT License',
  '',
  'Copyright (c) Meta Platforms, Inc. and affiliates.',
  '',
].join('\n');

let root;
let bin;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'release-package-'));
  bin = join(root, 'bin');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  mkdirSync(bin);
  // Writes the part of a CycloneDX document that release-package.sh edits.
  const fake = join(bin, 'cyclonedx-yarn');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  writeFileSync(
    fake,
    `#!${join(NODE_DIR, 'node')}
const args = process.argv.slice(2);
const file = args[args.indexOf('--output-file') + 1];
require('node:fs').writeFileSync(file, JSON.stringify({ metadata: { component: { name: 'app', version: '0.0.0' } } }));
`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  chmodSync(fake, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(repo, path, text = 'x\n') {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  writeFileSync(join(repo, path), text);
}

/** A tagged v1.2.3 checkout with the build output the script packs. `notices` is its content. */
function release({ notices } = { notices: NOTICES_TEXT }) {
  const repo = join(root, `repo-${counter++}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(SCRIPT, join(repo, 'scripts/release-package.sh'));
  write(repo, 'package.json', '{"name":"c15t-platform","version":"1.2.3"}\n');
  write(repo, 'yarn.lock');
  write(repo, 'LICENSE');
  for (const app of ['consent-api', 'dashboard-api', 'dashboard-web']) {
    write(repo, `apps/${app}/package.json`, `{"name":"@consent/${app}"}\n`);
  }
  write(repo, 'apps/consent-api/dist/server.js');
  write(repo, 'apps/dashboard-api/dist/server.js');
  write(repo, 'apps/dashboard-web/dist/index.html');
  write(repo, 'apps/dashboard-web/dist/assets/app.js', 'bundle\n');
  if (notices !== undefined) write(repo, NOTICES, notices);
  write(repo, 'packages/db/package.json');
  write(repo, 'packages/db/dist/index.js');
  write(repo, 'packages/db/drizzle/0000.sql');
  write(repo, 'packages/shared/package.json');
  write(repo, 'packages/shared/dist/index.js');
  const identity = {
    GIT_AUTHOR_NAME: 'Una Dev',
    GIT_AUTHOR_EMAIL: 'una@example.com',
    GIT_COMMITTER_NAME: 'Una Dev',
    GIT_COMMITTER_EMAIL: 'una@example.com',
  };
  git(repo, ['add', '-A', '-f'], identity);
  git(repo, ['commit', '-q', '-m', 'release'], identity);
  git(repo, ['tag', 'v1.2.3'], identity);
  return repo;
}

function pack(repo) {
  const out = join(repo, '..', `out-${counter++}`);
  const result = run('bash', ['scripts/release-package.sh', 'v1.2.3', out], {
    cwd: repo,
    env: gitEnv({ PATH: `${bin}:${NODE_DIR}:${process.env.PATH}` }),
  });
  return { ...result, out };
}

const WEB = 'c15t-platform-1.2.3-dashboard-web';

describe('the dashboard-web tarball', () => {
  test('carries THIRD-PARTY-NOTICES.md, and SHA256SUMS covers the tarball', () => {
    const { status, stderr, stdout, out } = pack(release());
    expect(status, stderr).toBe(0);
    expect(stdout).not.toContain('warning');

    const listing = run('tar', ['-tzf', join(out, `${WEB}.tar.gz`)]).stdout.split('\n');
    expect(listing).toContain(`${WEB}/${NOTICES}`);
    expect(listing).toContain(`${WEB}/LICENSE`);

    const extracted = run('tar', ['-xzOf', join(out, `${WEB}.tar.gz`), `${WEB}/${NOTICES}`]);
    expect(extracted.stdout).toBe(NOTICES_TEXT);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8');
    expect(sums).toMatch(new RegExp(`^[0-9a-f]{64} {2}${WEB}\\.tar\\.gz$`, 'm'));
    const verify = run('sha256sum', ['--check', '--strict', 'SHA256SUMS'], { cwd: out });
    expect(verify.status, verify.stdout + verify.stderr).toBe(0);
  });

  test('is refused when the build wrote no notices', () => {
    const { status, stderr, out } = pack(release({ notices: undefined }));
    expect(status).toBe(1);
    expect(stderr).toContain('THIRD-PARTY-NOTICES.md');
    expect(stderr).toContain('build.license');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp path inside the test's own directory
    expect(() => readFileSync(join(out, 'SHA256SUMS'))).toThrow();
  });

  test.each([
    ['empty', ''],
    [
      'without a single dependency',
      '# Licenses\n\nThe app does not bundle any dependencies with licenses.\n',
    ],
  ])('is refused when the notices are %s', (_label, notices) => {
    const { status, stderr } = pack(release({ notices }));
    expect(status).toBe(1);
    expect(stderr).toContain('THIRD-PARTY-NOTICES.md');
  });

  test('warns, without failing, about a package that ships no license text', () => {
    const notices = `${NOTICES_TEXT}\n## no-license-pkg - 1.0.0 (MIT)\n\n## last-pkg - 2.0.0 (ISC)\n`;
    const { status, stderr, stdout } = pack(release({ notices }));
    expect(status, stderr).toBe(0);
    expect(stdout).toContain('no license text in the package of: no-license-pkg - 1.0.0 (MIT)');
    expect(stdout).toContain('no license text in the package of: last-pkg - 2.0.0 (ISC)');
    expect(stdout).not.toContain('of: react');
  });
});
