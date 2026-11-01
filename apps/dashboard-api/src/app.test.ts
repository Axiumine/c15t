// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { user as userTable } from '@consent/db';
import { apiErrorSchema, userSummarySchema } from '@consent/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from './app.js';
import { silentLogger } from './logger.js';
import {
  closeIfOpen,
  createTestApp,
  TEST_ORIGIN,
  type TestApp,
  type TestUser,
} from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

describeEnvironments('app', ({ env }) => {
  let t: TestApp;
  let admin: TestUser;
  let adminCookie: string;

  /** The same app on the same database, with the clock fixed at `at`. */
  const appAt = (at: string) =>
    createApp({
      env: { BETTER_AUTH_URL: TEST_ORIGIN },
      db: t.db,
      auth: t.auth,
      logger: silentLogger,
      now: () => new Date(at),
    });
  const getAt = (at: string, path: string, cookie: string) =>
    appAt(at).request(`${TEST_ORIGIN}${path}`, {
      headers: { cookie, origin: TEST_ORIGIN, 'x-forwarded-for': t.nextIp() },
    });

  beforeAll(async () => {
    t = createTestApp(env());
    admin = await t.createUser({ role: 'admin', label: 'clock-admin' });
    adminCookie = await t.signIn(admin);
  }, 120_000);

  afterAll(async () => {
    await closeIfOpen(t);
  });

  test('an unparsable Referer is not a trusted origin: the write is refused (CSRF)', async () => {
    for (const referer of ['not a url', '', '//', 'javascript:alert(1)']) {
      const response = await t.request('POST', '/api/admin/sites', {
        cookie: adminCookie,
        noOrigin: true,
        headers: { referer },
        json: { key: `${env().prefix}-csrf`, name: 'x', domains: ['x.example.test'] },
      });
      expect(response.status, referer).toBe(403);
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe('FORBIDDEN');
    }
    // Nothing was created, even for a signed-in admin.
    const list = await t.request('GET', '/api/admin/sites', { cookie: adminCookie });
    const { items } = (await list.json()) as { items: { key: string }[] };
    expect(items.map((row) => row.key)).not.toContain(`${env().prefix}-csrf`);
  });

  test('the injected clock decides when a ban has expired, for the guard and for the user list', async () => {
    const victim = await t.createUser({ label: 'clock-victim' });
    const cookie = await t.signIn(victim);
    // Set directly, so the session survives and only the expiry date matters.
    await t.db.primary
      .update(userTable)
      .set({ banned: true, banExpires: new Date('2100-01-01T00:00:00Z') })
      .where(eq(userTable.id, victim.id));

    const before = await getAt('2099-12-31T00:00:00Z', '/api/me', cookie);
    expect(before.status).toBe(401);
    expect(apiErrorSchema.parse(await before.json()).error.code).toBe('UNAUTHORIZED');
    expect((await getAt('2100-01-02T00:00:00Z', '/api/me', cookie)).status).toBe(200);

    const bannedAt = async (at: string) => {
      const response = await getAt(at, '/api/admin/users', adminCookie);
      const { items } = (await response.json()) as { items: unknown[] };
      const row = items
        .map((item) => userSummarySchema.parse(item))
        .find((u) => u.id === victim.id);
      return row?.banned;
    };
    expect(await bannedAt('2099-12-31T00:00:00Z')).toBe(true);
    expect(await bannedAt('2100-01-02T00:00:00Z')).toBe(false);
  });

  test('the injected clock reaches the site routes, and a user still sees only their own site', async () => {
    const member = await t.createUser({ label: 'clock-member' });
    const other = await t.createUser({ label: 'clock-other' });
    const mine = await t.createSite({ label: 'clock-mine', members: [member] });
    const memberCookie = await t.signIn(member);
    const otherCookie = await t.signIn(other);

    const csv = await getAt(
      '2030-06-15T12:00:00Z',
      `/api/sites/${mine.key}/consents.csv`,
      memberCookie,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-disposition')).toContain(`consents-${mine.key}-2030-06-15.csv`);
    await csv.text();

    // The same request from a user without access is a 404, whatever the clock says.
    const denied = await getAt(
      '2030-06-15T12:00:00Z',
      `/api/sites/${mine.key}/consents.csv`,
      otherCookie,
    );
    expect(denied.status).toBe(404);
    expect(denied.headers.get('content-disposition')).toBeNull();
  });
});
