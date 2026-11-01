// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/*
 * `migrate.ts` is the `yarn db:migrate` entry point: importing it runs it. The pool and the
 * migrator are replaced, so nothing here connects to a database.
 */
const mocks = vi.hoisted(() => ({
  createPool: vi.fn(),
  applyMigrations: vi.fn<(executor: unknown, options: { migrationsFolder: string }) => unknown>(),
  postgresExecutor: vi.fn(),
  end: vi.fn(),
}));
vi.mock('./pool.js', () => ({ createPool: mocks.createPool }));
vi.mock('./migrator.js', () => ({
  applyMigrations: mocks.applyMigrations,
  postgresExecutor: mocks.postgresExecutor,
}));

const executor = { kind: 'executor' };
const url = 'postgres://user:pw@db.invalid:5432/app';

class ExitCalled extends Error {
  readonly code: number | string | null | undefined;
  constructor(code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
    this.code = code;
  }
}

async function runCli(): Promise<void> {
  await import('./migrate.js');
}

beforeEach(() => {
  vi.resetModules();
  mocks.end.mockResolvedValue(undefined);
  mocks.createPool.mockReturnValue({ end: mocks.end });
  mocks.postgresExecutor.mockReturnValue(executor);
  mocks.applyMigrations.mockResolvedValue({ applied: 2 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Stop the module where it exits, like the real process would.
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitCalled(code);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('without DATABASE_URL_DASHBOARD', () => {
  test.each([
    ['empty', ''],
    ['unset', undefined],
  ])('a %s variable exits 1 before any connection is opened', async (_label, value) => {
    vi.stubEnv('DATABASE_URL_DASHBOARD', value);
    await expect(runCli()).rejects.toMatchObject({ code: 1 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL_DASHBOARD'));
    expect(mocks.createPool).not.toHaveBeenCalled();
    expect(mocks.applyMigrations).not.toHaveBeenCalled();
  });
});

describe('with DATABASE_URL_DASHBOARD', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL_DASHBOARD', url);
  });

  test('applies the migrations over one primary connection, then closes it', async () => {
    await runCli();
    expect(mocks.createPool).toHaveBeenCalledExactlyOnceWith({
      url,
      role: 'primary',
      applicationName: 'c15t-platform-migrate',
      max: 1,
    });
    expect(mocks.postgresExecutor).toHaveBeenCalledExactlyOnceWith({ end: mocks.end });
    const [passedExecutor, options] = mocks.applyMigrations.mock.calls[0] ?? [];
    expect(passedExecutor).toBe(executor);
    const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
    expect(options).toEqual({ migrationsFolder });
    expect(existsSync(`${migrationsFolder}/meta/_journal.json`)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[db] app schema is up to date (2 migration(s) applied)',
    );
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('closes the connection and surfaces the error when a migration fails', async () => {
    const failure = new Error('syntax error at or near "oops"');
    mocks.applyMigrations.mockRejectedValue(failure);
    await expect(runCli()).rejects.toBe(failure);
    expect(console.warn).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
  });
});
