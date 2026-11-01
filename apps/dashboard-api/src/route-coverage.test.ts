// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiErrorSchema } from '@consent/shared';
import { expect, test } from 'vitest';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { wrapDatabase } from './db.js';
import { silentLogger } from './logger.js';

/*
 * The route coverage test of README D10 / CLAUDE.md "Authorization": it walks `app.routes` and
 * calls every route WITHOUT a session. Anything outside the allowlist must answer 401. The
 * database behind the app throws on any use, so a route that reaches a query before its guard
 * fails this test as well. A new route that forgets its guard fails here before it can ship.
 */

const ORIGIN = 'https://dashboard.example.test';

const ALLOWLIST: readonly RegExp[] = [/^\/api\/auth\//, /^\/api\/health$/];

function unreachableDatabase() {
  const fail = () => {
    throw new Error('the database was used before a guard rejected the request');
  };
  const database = new Proxy(
    {},
    { get: (_target, property) => (typeof property === 'string' ? fail : undefined) },
  ) as never;
  return wrapDatabase({
    primary: database,
    analytics: database,
    ping: () => Promise.reject(new Error('down')),
    close: async () => undefined,
  });
}

const db = unreachableDatabase();
const auth = createAuth({
  db,
  env: { BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: ORIGIN },
  logger: silentLogger,
});
const app = createApp({ env: { BETTER_AUTH_URL: ORIGIN }, db, auth, logger: silentLogger });

interface Probe {
  method: string;
  path: string;
}

function routesOf(): Probe[] {
  const seen = new Set<string>();
  const probes: Probe[] = [];
  for (const route of app.routes) {
    // `ALL` entries are middleware; real routes name their method.
    if (route.method === 'ALL') continue;
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    probes.push({ method: route.method, path: route.path });
  }
  return probes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

const concretePath = (path: string) =>
  path.replaceAll(':siteKey', 'zz-probe').replaceAll(':id', 'probe').replaceAll('*', 'x');

function call(method: string, path: string, headers: Record<string, string> = {}) {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
  return app.request(`${ORIGIN}${concretePath(path)}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(hasBody ? { body: '{}' } : {}),
  });
}

test('the route tree is exactly the documented API (README "API (dashboard-api)")', () => {
  const found = routesOf().map((route) => `${route.method} ${route.path}`);
  expect(found).toEqual(
    [
      'GET /api/admin/audit',
      'GET /api/admin/sites',
      'POST /api/admin/sites',
      'PATCH /api/admin/sites/:siteKey',
      'GET /api/admin/users',
      'POST /api/admin/users',
      'PATCH /api/admin/users/:id',
      'POST /api/admin/users/:id/ban',
      'POST /api/admin/users/:id/reset-password',
      'POST /api/admin/users/:id/revoke-sessions',
      'PUT /api/admin/users/:id/sites',
      'POST /api/admin/users/:id/unban',
      'GET /api/auth/*',
      'POST /api/auth/*',
      'GET /api/health',
      'GET /api/me',
      'GET /api/sites',
      'GET /api/sites/:siteKey',
      'GET /api/sites/:siteKey/consents',
      'GET /api/sites/:siteKey/consents.csv',
      'GET /api/sites/:siteKey/stats',
    ].sort((a, b) => {
      const [methodA = '', pathA = ''] = a.split(' ');
      const [methodB = '', pathB = ''] = b.split(' ');
      return `${pathA} ${methodA}`.localeCompare(`${pathB} ${methodB}`);
    }),
  );
});

test('every route outside the allowlist answers 401 without a session', async () => {
  const guarded = routesOf().filter((route) => !ALLOWLIST.some((rule) => rule.test(route.path)));
  expect(guarded.length).toBeGreaterThanOrEqual(15);
  for (const route of guarded) {
    const response = await call(route.method, route.path);
    expect(response.status, `${route.method} ${route.path}`).toBe(401);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error.code, `${route.method} ${route.path}`).toBe('UNAUTHORIZED');
  }
});

test('a bogus session cookie is also a 401, on every guarded route', async () => {
  const guarded = routesOf().filter((route) => !ALLOWLIST.some((rule) => rule.test(route.path)));
  // Better Auth reads the database to verify a cookie, which the stub refuses: the guard must
  // turn that into a clean failure and never into a pass.
  for (const route of guarded) {
    const response = await call(route.method, route.path, {
      cookie: 'c15t-dashboard.session_token=forged.value',
    });
    expect(response.status, `${route.method} ${route.path}`).not.toBeLessThan(400);
    expect(response.status, `${route.method} ${route.path}`).not.toBe(200);
  }
});

test('the only open routes are health and the Better Auth sign-in family', async () => {
  const open = routesOf().filter((route) => ALLOWLIST.some((rule) => rule.test(route.path)));
  expect(open.map((route) => route.path).sort((a, b) => a.localeCompare(b))).toEqual([
    '/api/auth/*',
    '/api/auth/*',
    '/api/health',
  ]);
});

test('health answers without a session and reports a database that is down', async () => {
  const response = await call('GET', '/api/health');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'degraded', db: false });
});

test.each([
  ['a guarded route (401)', 'GET', '/api/me'],
  ['an unknown path (404)', 'GET', '/api/nothing-here'],
  ['an unknown path outside /api (404)', 'GET', '/elsewhere'],
  ['health (200)', 'GET', '/api/health'],
  ['a closed Better Auth endpoint (404)', 'POST', '/api/auth/admin/create-user'],
])('sends noindex and no-store on %s', async (_name, method, path) => {
  const response = await call(method, path);
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});

test('errors are JSON in the platform format, 404 included', async () => {
  const response = await call('GET', '/api/nothing-here');
  expect(response.status).toBe(404);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
});

test.each([
  ['sign-up', 'POST', '/api/auth/sign-up/email'],
  ['admin plugin: create-user', 'POST', '/api/auth/admin/create-user'],
  ['admin plugin: set-role', 'POST', '/api/auth/admin/set-role'],
  ['admin plugin: impersonate', 'POST', '/api/auth/admin/impersonate-user'],
  ['admin plugin: remove-user', 'POST', '/api/auth/admin/remove-user'],
  ['admin plugin: list-users', 'GET', '/api/auth/admin/list-users'],
  ['update-user', 'POST', '/api/auth/update-user'],
  ['sign-in with a trailing slash', 'POST', '/api/auth/sign-in/email/'],
  ['an encoded path', 'POST', '/api/auth/sign-in%2Femail'],
  ['request-password-reset', 'POST', '/api/auth/request-password-reset'],
])('keeps the Better Auth endpoint closed: %s', async (_name, method, path) => {
  const response = await app.request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  expect(response.status).toBe(404);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
});

test.each([
  ['no Origin or Referer', {}],
  ['a foreign Origin', { origin: 'https://evil.example.test' }],
  ['the Origin "null"', { origin: 'null' }],
  ['a foreign Referer', { referer: 'https://evil.example.test/page' }],
])('rejects a write with %s (CSRF)', async (_name, headers) => {
  const response = await app.request(`${ORIGIN}/api/admin/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  });
  expect(response.status).toBe(403);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe('FORBIDDEN');
});

test('a same-origin Referer is enough when the browser sends no Origin', async () => {
  const response = await app.request(`${ORIGIN}/api/admin/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', referer: `${ORIGIN}/admin/sites` },
    body: '{}',
  });
  expect(response.status).toBe(401);
});

test('refuses an oversized body', async () => {
  const response = await app.request(`${ORIGIN}/api/admin/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ padding: 'x'.repeat(70_000) }),
  });
  expect(response.status).toBe(400);
  expect(apiErrorSchema.parse(await response.json()).error.message).toMatch(/too large/);
});
