// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/** Runs the CLI source with a clean environment: only PATH, so no secret can leak in or out. */
async function cli(args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--import', 'tsx', '--conditions=source', 'src/admin-create.ts', ...args],
      { cwd: packageRoot, env: { PATH: process.env['PATH'] ?? '', ...env } },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

test('prints usage without --email', async () => {
  const result = await cli([]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Usage: yarn admin:create --email');
});

test('rejects an invalid email before touching the database', async () => {
  const result = await cli(['--email', 'not-an-email']);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Invalid email address');
});

test('reports missing configuration by variable name, without values', async () => {
  const result = await cli(['--email', 'someone@example.test'], {
    BETTER_AUTH_SECRET: 'short-secret-value',
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('DATABASE_URL_DASHBOARD');
  expect(result.stderr).toContain('BETTER_AUTH_URL');
  expect(result.stderr).not.toContain('short-secret-value');
  expect(result.stdout).toBe('');
});

test('refuses unknown options', async () => {
  const result = await cli(['--email', 'someone@example.test', '--password', 'chosen-by-me']);
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe('');
});
