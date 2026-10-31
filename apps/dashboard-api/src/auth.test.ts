// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { changedPasswordUserId, createAuth } from './auth.js';
import { wrapDatabase } from './db.js';
import { createLogger, silentLogger } from './logger.js';

const stub = new Proxy({}, { get: () => undefined }) as never;
const db = wrapDatabase({
  primary: stub,
  analytics: stub,
  ping: async () => undefined,
  close: async () => undefined,
});
const origin = 'https://dashboard.example.test';
const auth = createAuth({
  db,
  env: { BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: origin },
  logger: silentLogger,
});

test('sign-up is disabled and passwords have the platform length limits', () => {
  expect(auth.options.emailAndPassword).toMatchObject({
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  });
});

test('only the dashboard origin is trusted', () => {
  expect(auth.options.trustedOrigins).toEqual([origin]);
  expect(auth.options.baseURL).toBe(origin);
});

test('cookies are httpOnly, Secure and SameSite=Lax; the session is not cached in the cookie', () => {
  expect(auth.options.advanced).toMatchObject({
    useSecureCookies: true,
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: true },
  });
  expect(auth.options.session?.cookieCache?.enabled).toBe(false);
});

test('login and password change are rate limited in the database', () => {
  expect(auth.options.rateLimit).toMatchObject({ enabled: true, storage: 'database' });
  expect(auth.options.rateLimit?.customRules?.['/sign-in/email']).toEqual({ window: 300, max: 10 });
});

test('mustChangePassword cannot be written by a client', () => {
  expect(auth.options.user?.additionalFields?.['mustChangePassword']).toMatchObject({
    input: false,
  });
});

test('the user id is read from a successful change-password body only', () => {
  expect(changedPasswordUserId({ token: null, user: { id: 'u1' } })).toBe('u1');
  expect(changedPasswordUserId({ user: {} })).toBeUndefined();
  expect(changedPasswordUserId({ user: { id: '' } })).toBeUndefined();
  expect(changedPasswordUserId(new Error('INVALID_PASSWORD'))).toBeUndefined();
  expect(changedPasswordUserId(null)).toBeUndefined();
  expect(changedPasswordUserId('x')).toBeUndefined();
});

test('Better Auth warnings and errors are logged as one short line; lower levels are dropped', () => {
  const lines: { level: string; message: string; detail: string }[] = [];
  const logging = createAuth({
    db,
    env: { BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: origin },
    logger: createLogger((line) =>
      lines.push(JSON.parse(line) as { level: string; message: string; detail: string }),
    ),
  });
  const log = logging.options.logger?.log;
  expect(log).toBeTypeOf('function');
  expect(logging.options.logger?.level).toBe('warn');

  log?.('error', 'password hash $scrypt$secret\nat Object.<anonymous> (file.ts:1:1)');
  log?.('warn', `${'w'.repeat(400)}`);
  log?.('info', 'signed in u1');
  log?.('debug', 'verbose');

  expect(lines.map((line) => [line.level, line.message])).toEqual([
    ['error', 'better-auth'],
    ['warn', 'better-auth'],
  ]);
  expect(lines[0]?.detail).toBe('password hash $scrypt$secret');
  expect(lines[0]?.detail).not.toContain('file.ts');
  expect(lines[1]?.detail).toBe('w'.repeat(300));
});
