// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterEach, beforeEach, expect, type MockInstance, test, vi } from 'vitest';

/*
 * admin-create.ts is the `yarn admin:create` entry point: it runs on import. Each test imports it
 * afresh with a fake argv, a stubbed environment, a fake database and a process.exit that throws,
 * so no database is opened, no secret is read from the real environment and the worker stays up.
 */

interface AuthOptions {
  db: unknown;
  env: unknown;
  logger: { error(message: string): void };
}

interface Created {
  userId: string;
  email: string;
  oneTimePassword: string;
}

const mocks = vi.hoisted(() => ({
  createAuth: vi.fn<(options: AuthOptions) => unknown>(),
  createAdmin:
    vi.fn<
      (auth: unknown, input: { email: string; name: string | undefined }) => Promise<Created>
    >(),
  openDatabase: vi.fn(),
  db: { close: vi.fn() },
  auth: { name: 'auth' },
}));

vi.mock('./auth.js', () => ({ createAuth: mocks.createAuth }));
vi.mock('./db.js', () => ({ openDatabase: mocks.openDatabase }));
vi.mock('./bootstrap.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bootstrap.js')>()),
  createAdmin: mocks.createAdmin,
}));

class ExitSignal extends Error {
  readonly code: number | undefined;

  constructor(code: number | undefined) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

const config = {
  DATABASE_URL_DASHBOARD: 'postgres://dashboard:pw@pg-primary.internal:5432/consent',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'https://dashboard.example.test',
};

const originalArgv = process.argv;
let stdout: MockInstance<typeof process.stdout.write>;
let stderr: MockInstance<typeof process.stderr.write>;

function written(spy: {
  readonly mock: { readonly calls: readonly (readonly unknown[])[] };
}): string {
  return spy.mock.calls.map(([chunk]) => String(chunk)).join('');
}

function stubConfig(values: Record<string, string | undefined> = config) {
  for (const name of Object.keys(config)) vi.stubEnv(name, values[name]);
}

/** Runs the entry point and reports how it ended: the exit code, or the error it threw. */
async function run(args: string[], prepare?: () => Promise<void>) {
  vi.resetModules();
  process.argv = ['node', 'admin-create.ts', ...args];
  await prepare?.();
  let code: number | undefined;
  let failure: unknown;
  try {
    await import('./admin-create.js');
  } catch (error) {
    if (error instanceof ExitSignal) code = error.code;
    else failure = error;
  }
  return { code, failure, stdout: written(stdout), stderr: written(stderr) };
}

beforeEach(() => {
  for (const mock of [mocks.createAuth, mocks.createAdmin, mocks.openDatabase, mocks.db.close]) {
    mock.mockReset();
  }
  mocks.openDatabase.mockReturnValue(mocks.db);
  mocks.createAuth.mockReturnValue(mocks.auth);
  mocks.db.close.mockResolvedValue(undefined);
  stubConfig();
  stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSignal(code);
  }) as never);
});

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.doUnmock('./env.js');
  vi.restoreAllMocks();
});

test('prints usage without --email', async () => {
  const result = await run([]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Usage: yarn admin:create --email');
  expect(result.stdout).toBe('');
  expect(mocks.openDatabase).not.toHaveBeenCalled();
});

test('rejects an invalid email before touching the database', async () => {
  const result = await run(['--email', 'not-an-email']);
  expect(result.code).toBe(1);
  expect(result.stderr).toBe('Invalid email address\n');
  expect(mocks.openDatabase).not.toHaveBeenCalled();
});

test('reports missing configuration by variable name, without values', async () => {
  stubConfig({ BETTER_AUTH_SECRET: 'short-secret-value' });
  const result = await run(['--email', 'someone@example.test']);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('DATABASE_URL_DASHBOARD');
  expect(result.stderr).toContain('BETTER_AUTH_URL');
  expect(result.stderr).toContain('BETTER_AUTH_SECRET');
  expect(result.stderr).not.toContain('short-secret-value');
  expect(result.stdout).toBe('');
  expect(mocks.openDatabase).not.toHaveBeenCalled();
});

test('does not echo the reason when the environment cannot be read at all', async () => {
  const result = await run(['--email', 'someone@example.test'], async () => {
    vi.doMock('./env.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./env.js')>()),
      loadCliEnv: () => {
        throw new Error('cannot read /etc/secret-file');
      },
    }));
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toBe('Could not read the environment\n');
  expect(mocks.openDatabase).not.toHaveBeenCalled();
});

test('refuses unknown options', async () => {
  const result = await run(['--email', 'someone@example.test', '--password', 'chosen-by-me']);
  expect(result.failure).toMatchObject({ code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  expect(result.code).toBeUndefined();
  expect(result.stdout).toBe('');
  expect(mocks.openDatabase).not.toHaveBeenCalled();
  expect(mocks.createAdmin).not.toHaveBeenCalled();
});

test('creates the administrator on one short-lived primary connection and prints the password once', async () => {
  mocks.createAdmin.mockResolvedValue({
    userId: 'u1',
    email: 'someone@example.test',
    oneTimePassword: 'correct-horse-battery',
  });
  const result = await run(['--email', 'someone@example.test', '--name', 'Some One']);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    [
      'Created administrator someone@example.test',
      'One-time password (shown once, change it at the first login): correct-horse-battery',
      '',
    ].join('\n'),
  );
  expect(mocks.openDatabase).toHaveBeenCalledExactlyOnceWith(
    {
      DATABASE_URL_DASHBOARD: config.DATABASE_URL_DASHBOARD,
      DATABASE_URL_DASHBOARD_REPLICA: undefined,
    },
    'c15t-platform-admin-create',
  );
  expect(mocks.createAdmin).toHaveBeenCalledExactlyOnceWith(
    { db: mocks.db, auth: mocks.auth },
    { email: 'someone@example.test', name: 'Some One' },
  );
  expect(mocks.db.close).toHaveBeenCalledOnce();
});

test('Better Auth gets the CLI configuration and a logger that writes nothing', async () => {
  mocks.createAdmin.mockResolvedValue({
    userId: 'u1',
    email: 'a@example.test',
    oneTimePassword: 'p',
  });
  await run(['--email', 'a@example.test']);
  const options = mocks.createAuth.mock.calls[0]?.[0];
  expect(options?.db).toBe(mocks.db);
  expect(options?.env).toEqual(config);
  stderr.mockClear();
  stdout.mockClear();
  options?.logger.error('anything');
  expect(stderr).not.toHaveBeenCalled();
  expect(stdout).not.toHaveBeenCalled();
});

test('the name is optional', async () => {
  mocks.createAdmin.mockResolvedValue({
    userId: 'u1',
    email: 'a@example.test',
    oneTimePassword: 'p',
  });
  const result = await run(['--email', 'a@example.test']);
  expect(result.code).toBe(0);
  expect(mocks.createAdmin.mock.calls[0]?.[1]).toEqual({
    email: 'a@example.test',
    name: undefined,
  });
});

test('says so when the administrator already exists, and still closes the connection', async () => {
  const result = await run(['--email', 'someone@example.test'], async () => {
    const { AdminExistsError } = await import('./bootstrap.js');
    mocks.createAdmin.mockRejectedValue(new AdminExistsError('someone@example.test'));
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toBe('A user with the email someone@example.test already exists\n');
  expect(result.stdout).toBe('');
  expect(mocks.db.close).toHaveBeenCalledOnce();
});

test('any other failure is reported generically, without its details', async () => {
  mocks.createAdmin.mockRejectedValue(
    new Error('insert into "user" failed: postgres://dashboard:pw@host'),
  );
  const result = await run(['--email', 'someone@example.test']);
  expect(result.code).toBe(1);
  expect(result.stderr).toBe('Could not create the administrator\n');
  expect(result.stdout).toBe('');
  expect(mocks.db.close).toHaveBeenCalledOnce();
});
