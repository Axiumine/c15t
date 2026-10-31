// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterEach, expect, test, vi } from 'vitest';
import { compose } from './compose.js';
import { type AppDatabase, openDatabase, wrapDatabase } from './db.js';
import type { Env } from './env.js';
import { silentLogger } from './logger.js';

vi.mock('./db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db.js')>()),
  openDatabase: vi.fn(),
}));

const ORIGIN = 'https://dashboard.example.test';
const env: Env = {
  DASHBOARD_API_HOST: '127.0.0.1',
  DASHBOARD_API_PORT: 4200,
  DATABASE_URL_DASHBOARD: 'postgres://dashboard:pw@pg-primary.internal:5432/consent',
  DATABASE_URL_DASHBOARD_REPLICA: undefined,
  CONSENT_API_URL: undefined,
  C15T_ADMIN_API_KEY: undefined,
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: ORIGIN,
};

const stub = new Proxy({}, { get: () => undefined }) as never;

function fakeDatabase(ping: () => Promise<void>): AppDatabase {
  return wrapDatabase({ primary: stub, analytics: stub, ping, close: async () => undefined });
}

afterEach(() => {
  vi.mocked(openDatabase).mockReset();
});

test('opens the pools from the environment and returns them with the app', () => {
  const db = fakeDatabase(async () => undefined);
  vi.mocked(openDatabase).mockReturnValue(db);
  const services = compose(env, silentLogger);
  expect(openDatabase).toHaveBeenCalledExactlyOnceWith(env);
  expect(services.db).toBe(db);
});

test('the app answers /api/health through the pools it opened', async () => {
  const ping = vi.fn(async () => undefined);
  vi.mocked(openDatabase).mockReturnValue(fakeDatabase(ping));
  const { app } = compose(env, silentLogger);
  const response = await app.request('/api/health');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', db: true });
  expect(ping).toHaveBeenCalledOnce();
});

test('the app guards the API with Better Auth: no session, no access', async () => {
  vi.mocked(openDatabase).mockReturnValue(fakeDatabase(async () => undefined));
  const { app } = compose(env, silentLogger);
  expect((await app.request('/api/me')).status).toBe(401);
  expect((await app.request('/api/admin/users')).status).toBe(401);
});

test('the app trusts only the origin of BETTER_AUTH_URL', async () => {
  vi.mocked(openDatabase).mockReturnValue(fakeDatabase(async () => undefined));
  const { app } = compose(env, silentLogger);
  const response = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example.test' },
    body: JSON.stringify({ email: 'a@example.test', password: 'whatever-password' }),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
});
