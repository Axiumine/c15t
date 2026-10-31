// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Database } from '@consent/db';
import { adminAudit } from '@consent/db';
import { apiErrorSchema, userSummarySchema } from '@consent/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApi } from '../app.js';
import { createErrorHandler } from '../errors.js';
import { silentLogger } from '../logger.js';
import { createTestApp, TEST_ORIGIN, type TestApp, type TestUser } from '../testing/harness.js';
import { describeEnvironments } from '../testing/suite.js';

/** A database in which every select finds nothing: the rows are gone by the time they are read. */
function emptyDatabase(): Database {
  const chain: unknown = new Proxy(() => undefined, {
    get: (_target, property) =>
      property === 'then' ? (resolve: (rows: unknown[]) => void) => resolve([]) : () => chain,
  });
  return { select: () => chain } as unknown as Database;
}

describeEnvironments('admin users: partial updates and bans', ({ env }) => {
  let t: TestApp;
  let admin: TestUser;
  let adminCookie: string;

  const send = (method: string, path: string, json?: unknown) =>
    t.request(method, path, {
      cookie: adminCookie,
      ip: t.nextIp(),
      ...(json === undefined ? {} : { json }),
    });
  const auditOf = (targetId: string) =>
    t.db.primary
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.targetId, targetId))
      .orderBy(asc(adminAudit.createdAt));

  beforeAll(async () => {
    t = createTestApp(env());
    admin = await t.createUser({ role: 'admin', label: 'users-admin' });
    adminCookie = await t.signIn(admin);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  test('a PATCH with only a name changes the name and leaves the role alone', async () => {
    const target = await t.createUser({ label: 'rename-only' });
    const response = await send('PATCH', `/api/admin/users/${target.id}`, { name: 'Renamed' });
    expect(response.status).toBe(200);
    expect(userSummarySchema.parse(await response.json())).toMatchObject({
      id: target.id,
      name: 'Renamed',
      role: 'user',
    });
    const [entry] = await auditOf(target.id);
    expect(entry?.action).toBe('user.update');
    expect(entry?.metadata).toEqual({ changes: { name: { from: 'Test user', to: 'Renamed' } } });
  });

  test('a PATCH with only a role changes the role and leaves the name alone', async () => {
    const target = await t.createUser({ label: 'promote-only' });
    const response = await send('PATCH', `/api/admin/users/${target.id}`, { role: 'admin' });
    expect(response.status).toBe(200);
    expect(userSummarySchema.parse(await response.json())).toMatchObject({
      id: target.id,
      name: 'Test user',
      role: 'admin',
    });
    const [entry] = await auditOf(target.id);
    expect(entry?.metadata).toEqual({ changes: { role: { from: 'user', to: 'admin' } } });
  });

  test('a ban needs neither a reason nor an expiry, and the audit row records only what was given', async () => {
    const target = await t.createUser({ label: 'bare-ban' });
    const bare = await send('POST', `/api/admin/users/${target.id}/ban`, {});
    expect(bare.status).toBe(200);
    expect(userSummarySchema.parse(await bare.json())).toMatchObject({
      id: target.id,
      banned: true,
      banExpires: null,
    });
    expect((await send('POST', `/api/admin/users/${target.id}/unban`)).status).toBe(200);

    const timed = await send('POST', `/api/admin/users/${target.id}/ban`, {
      expiresInSeconds: 3600,
    });
    expect(userSummarySchema.parse(await timed.json())).toMatchObject({ banned: true });

    const bans = (await auditOf(target.id)).filter((entry) => entry.action === 'user.ban');
    expect(bans.map((entry) => entry.metadata)).toEqual([{}, { expiresInSeconds: 3600 }]);
    expect(JSON.stringify(bans)).not.toContain('reason');
  });

  test('a user who is gone when the result is read is a 404, not a crash or an empty 200', async () => {
    const target = await t.createUser({ label: 'vanishing' });
    // The transaction runs on the real database, the summary read afterwards finds no row.
    const api = createApi({
      env: { BETTER_AUTH_URL: TEST_ORIGIN },
      db: { ...t.db, primary: emptyDatabase() },
      auth: t.auth,
      logger: silentLogger,
    });
    const app = new Hono().route('/api', api).onError(createErrorHandler(silentLogger));
    const response = await app.request(`${TEST_ORIGIN}/api/admin/users/${target.id}/unban`, {
      method: 'POST',
      headers: { cookie: adminCookie, origin: TEST_ORIGIN },
    });
    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await response.json()).error).toEqual({
      code: 'NOT_FOUND',
      message: 'User not found',
    });
  });
});
