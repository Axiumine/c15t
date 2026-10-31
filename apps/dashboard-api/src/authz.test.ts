// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { user as userTable } from '@consent/db';
import {
  apiErrorSchema,
  consentPageSchema,
  siteDetailSchema,
  siteSchema,
  statsResponseSchema,
} from '@consent/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Auth } from './auth.js';
import { accessibleSiteKeys, accessibleSites, createAuthz, type SessionUser } from './authz.js';
import { createErrorHandler } from './errors.js';
import { silentLogger } from './logger.js';
import { cookieHeader, createTestApp, type TestApp, type TestUser } from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

/*
 * Phase 4 authz suite: two sites, users with different access, and every read route probed
 * from the wrong side. Runs on PGlite and on the real dev database.
 */
describeEnvironments('authz', ({ env }) => {
  let t: TestApp;
  let admin: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let site1: { key: string; id: string };
  let site2: { key: string; id: string };
  let siteOff: { key: string; id: string };
  let adminCookie: string;
  let aliceCookie: string;
  let bobCookie: string;
  let carolCookie: string;

  const get = (path: string, cookie?: string) =>
    t.request('GET', path, cookie === undefined ? {} : { cookie });
  const send = (method: string, path: string, cookie: string, json?: unknown) =>
    t.request(method, path, { cookie, ...(json === undefined ? {} : { json }) });
  const subject = (site: string, n: string) => `${env().prefix}-${site}-subject-${n}`;

  beforeAll(async () => {
    t = createTestApp(env());
    admin = await t.createUser({ role: 'admin', label: 'admin' });
    alice = await t.createUser({ label: 'alice' });
    bob = await t.createUser({ label: 'bob' });
    carol = await t.createUser({ label: 'carol' });
    site1 = await t.createSite({ label: 's1', members: [alice] });
    site2 = await t.createSite({ label: 's2', members: [bob] });
    siteOff = await t.createSite({ label: 'off', status: 'disabled', members: [alice] });
    await env().seedConsents([
      ...['a', 'b', 'c'].map((n) => ({
        tenantId: site1.key,
        subjectId: subject('one', n),
        domain: 'one.example.test',
        givenAt: `2026-03-0${n === 'a' ? 1 : 2} 10:00:00`,
        choice: { measurement: true, marketing: n === 'a' },
        jurisdiction: 'GDPR',
      })),
      ...['a', 'b'].map((n) => ({
        tenantId: site2.key,
        subjectId: subject('two', n),
        domain: 'two.example.test',
        givenAt: '2026-03-02 11:00:00',
        choice: { measurement: false },
        jurisdiction: 'CCPA',
      })),
      {
        tenantId: siteOff.key,
        subjectId: subject('off', 'a'),
        domain: 'off.example.test',
        givenAt: '2026-03-02 12:00:00',
      },
    ]);
    [adminCookie, aliceCookie, bobCookie, carolCookie] = await Promise.all([
      t.signIn(admin),
      t.signIn(alice),
      t.signIn(bob),
      t.signIn(carol),
    ]);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  /* Site visibility */

  test('a user lists only the active sites assigned to them', async () => {
    const response = await get('/api/sites', aliceCookie);
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: unknown[] };
    const sites = items.map((item) => siteSchema.parse(item));
    expect(sites.map((s) => s.key)).toEqual([site1.key]);

    const bobSites = (await (await get('/api/sites', bobCookie)).json()) as {
      items: { key: string }[];
    };
    expect(bobSites.items.map((s) => s.key)).toEqual([site2.key]);
    const carolSites = (await (await get('/api/sites', carolCookie)).json()) as {
      items: unknown[];
    };
    expect(carolSites.items).toEqual([]);
  });

  test('an admin lists every site, disabled ones included', async () => {
    const { items } = (await (await get('/api/sites', adminCookie)).json()) as {
      items: { key: string; status: string }[];
    };
    const mine = items.filter((s) => s.key.startsWith(env().prefix)).map((s) => [s.key, s.status]);
    expect(mine.sort()).toEqual(
      [
        [site1.key, 'active'],
        [site2.key, 'active'],
        [siteOff.key, 'disabled'],
      ].sort(),
    );
  });

  test('a user reads their own site: detail, stats, records and CSV', async () => {
    const detail = await get(`/api/sites/${site1.key}`, aliceCookie);
    expect(detail.status).toBe(200);
    const body = siteDetailSchema.parse(await detail.json());
    expect(body.setup.nginx).toBe(`set $c15t_site ${site1.key};\ninclude snippets/c15t.conf;`);

    const stats = await get(
      `/api/sites/${site1.key}/stats?from=2026-03-01&to=2026-03-07`,
      aliceCookie,
    );
    expect(stats.status).toBe(200);
    expect(statsResponseSchema.parse(await stats.json()).totals).toEqual({
      consents: 3,
      subjects: 3,
    });

    const list = await get(`/api/sites/${site1.key}/consents`, aliceCookie);
    const page = consentPageSchema.parse(await list.json());
    expect(page.items.map((item) => item.subjectId).sort()).toEqual(
      ['a', 'b', 'c'].map((n) => subject('one', n)),
    );

    const csv = await get(`/api/sites/${site1.key}/consents.csv`, aliceCookie);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain(`consents-${site1.key}-`);
    const rows = (await csv.text()).trim().split('\r\n');
    expect(rows).toHaveLength(4);
    expect(rows.join('\n')).not.toContain('-two-');
  });

  const sessionUser = (user: TestUser): SessionUser => ({
    id: user.id,
    name: `Test ${user.role}`,
    email: user.email,
    role: user.role,
    mustChangePassword: false,
  });

  test('the accessible site keys are the active assigned sites for a user, every site for an admin', async () => {
    const mine = (keys: readonly string[]) => keys.filter((key) => key.startsWith(env().prefix));
    // Ordered by site name, then key: `Site <prefix>-off` < `-s1` < `-s2`.
    expect(mine(await accessibleSiteKeys(t.db.primary, sessionUser(admin)))).toEqual([
      siteOff.key,
      site1.key,
      site2.key,
    ]);
    // Alice is a member of site1 and of the disabled site: the disabled one stays hidden.
    expect(await accessibleSiteKeys(t.db.primary, sessionUser(alice))).toEqual([site1.key]);
    expect(await accessibleSiteKeys(t.db.primary, sessionUser(bob))).toEqual([site2.key]);
    expect(await accessibleSiteKeys(t.db.primary, sessionUser(carol))).toEqual([]);
    const rows = await accessibleSites(t.db.primary, sessionUser(alice));
    expect(rows.map((row) => row.id)).toEqual([site1.id]);
  });

  const siteReadRoutes = (key: string) => [
    `/api/sites/${key}`,
    `/api/sites/${key}/stats`,
    `/api/sites/${key}/consents`,
    `/api/sites/${key}/consents?subject=anything`,
    `/api/sites/${key}/consents.csv`,
  ];

  test('a user gets 404 on every read route of a site assigned to someone else', async () => {
    for (const path of siteReadRoutes(site2.key)) {
      const response = await get(path, aliceCookie);
      expect(response.status, path).toBe(404);
      expect(apiErrorSchema.parse(await response.json()).error.code, path).toBe('NOT_FOUND');
    }
    for (const path of siteReadRoutes(site1.key)) {
      expect((await get(path, bobCookie)).status, path).toBe(404);
      expect((await get(path, carolCookie)).status, path).toBe(404);
    }
  });

  test('another site looks exactly like a site that does not exist (no enumeration)', async () => {
    const ghost = `${env().prefix}-ghost`;
    for (const [real, missing] of siteReadRoutes(site2.key).map(
      (path, i) => [path, siteReadRoutes(ghost)[i] as string] as const,
    )) {
      const a = await get(real, aliceCookie);
      const b = await get(missing, aliceCookie);
      expect(a.status).toBe(b.status);
      expect(await a.json()).toEqual(await b.json());
    }
  });

  test('a malformed site key is a 404 too, never a query', async () => {
    for (const key of ['UPPER', 'a', 'x'.repeat(41), 'has space', '..', "a'b"]) {
      const response = await get(`/api/sites/${encodeURIComponent(key)}/consents`, aliceCookie);
      expect(response.status, key).toBe(404);
    }
  });

  test('the record search of one site cannot be pointed at another site data', async () => {
    const other = subject('two', 'a');
    const page = consentPageSchema.parse(
      await (
        await get(
          `/api/sites/${site1.key}/consents?subject=${encodeURIComponent(other)}`,
          aliceCookie,
        )
      ).json(),
    );
    expect(page.items).toEqual([]);
    // Extra query parameters do not widen the scope.
    const tampered = await get(
      `/api/sites/${site1.key}/consents?tenantId=${site2.key}&siteKey=${site2.key}&limit=200`,
      aliceCookie,
    );
    const items = consentPageSchema.parse(await tampered.json()).items;
    expect(items.every((item) => item.subjectId.includes('-one-'))).toBe(true);
  });

  test('a cursor taken from one site cannot be replayed to read another site', async () => {
    const first = consentPageSchema.parse(
      await (await get(`/api/sites/${site1.key}/consents?limit=1`, aliceCookie)).json(),
    );
    expect(first.nextCursor).not.toBeNull();
    const replay = await get(
      `/api/sites/${site2.key}/consents?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      aliceCookie,
    );
    expect(replay.status).toBe(404);
    // Even for the owner of site 2: the cursor only carries a sort key, so it cannot leak site 1.
    const asBob = consentPageSchema.parse(
      await (
        await get(
          `/api/sites/${site2.key}/consents?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
          bobCookie,
        )
      ).json(),
    );
    expect(asBob.items.every((item) => item.subjectId.includes('-two-'))).toBe(true);
  });

  test('a disabled site is invisible to its users but visible to admins', async () => {
    const list = (await (await get('/api/sites', aliceCookie)).json()) as {
      items: { key: string }[];
    };
    expect(list.items.map((s) => s.key)).not.toContain(siteOff.key);
    for (const path of siteReadRoutes(siteOff.key)) {
      expect((await get(path, aliceCookie)).status, path).toBe(404);
      expect((await get(path, adminCookie)).status, path).toBe(200);
    }
    const detail = siteDetailSchema.parse(
      await (await get(`/api/sites/${siteOff.key}`, adminCookie)).json(),
    );
    expect(detail.status).toBe('disabled');
  });

  test('an admin can read the data of every site', async () => {
    for (const site of [site1, site2]) {
      const page = consentPageSchema.parse(
        await (await get(`/api/sites/${site.key}/consents`, adminCookie)).json(),
      );
      expect(page.items.length).toBeGreaterThan(0);
    }
  });

  /* Admin routes */

  test('a user gets 403 on every admin route and nothing changes', async () => {
    const calls: [string, string, unknown?][] = [
      ['GET', '/api/admin/sites'],
      ['POST', '/api/admin/sites', {}],
      ['PATCH', `/api/admin/sites/${site1.key}`, { name: 'hacked' }],
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users', {}],
      ['PATCH', `/api/admin/users/${alice.id}`, { role: 'admin' }],
      ['PUT', `/api/admin/users/${alice.id}/sites`, { siteKeys: [site1.key, site2.key] }],
      ['POST', `/api/admin/users/${bob.id}/reset-password`],
      ['POST', `/api/admin/users/${bob.id}/ban`, {}],
      ['POST', `/api/admin/users/${bob.id}/unban`],
      ['POST', `/api/admin/users/${bob.id}/revoke-sessions`],
      ['GET', '/api/admin/audit'],
    ];
    for (const [method, path, body] of calls) {
      const response = await send(method, path, aliceCookie, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe('FORBIDDEN');
    }
    // Nothing happened: alice is still a plain user of site 1 only, bob still works.
    expect((await get(`/api/sites/${site2.key}`, aliceCookie)).status).toBe(404);
    expect(
      (await get('/api/me', aliceCookie).then((r) => r.json())) as { role: string },
    ).toMatchObject({
      role: 'user',
    });
    expect((await get('/api/me', bobCookie)).status).toBe(200);
    const detail = siteDetailSchema.parse(
      await (await get(`/api/sites/${site1.key}`, aliceCookie)).json(),
    );
    expect(detail.name).not.toBe('hacked');
  });

  test('the Better Auth admin endpoints are not a way around the API', async () => {
    const attempts: [string, string, unknown?][] = [
      ['POST', '/api/auth/admin/set-role', { userId: alice.id, role: 'admin' }],
      [
        'POST',
        '/api/auth/admin/create-user',
        { email: 'x@example.test', password: 'abcdefghijkl', name: 'x' },
      ],
      ['POST', '/api/auth/update-user', { role: 'admin', mustChangePassword: false }],
    ];
    for (const [method, path, body] of attempts) {
      expect((await send(method, path, aliceCookie, body)).status, path).toBe(404);
    }
    const me = (await (await get('/api/me', aliceCookie)).json()) as { role: string };
    expect(me.role).toBe('user');
  });

  /* Sessions, bans, roles, memberships take effect at once */

  test('a banned user is rejected: the old session dies and sign-in is refused', async () => {
    const victim = await t.createUser({ label: 'victim' });
    const cookie = await t.signIn(victim);
    expect((await get('/api/me', cookie)).status).toBe(200);

    const ban = await send('POST', `/api/admin/users/${victim.id}/ban`, adminCookie, {
      reason: 'test',
    });
    expect(ban.status).toBe(200);
    const after = await get('/api/me', cookie);
    expect(after.status).toBe(401);
    expect(apiErrorSchema.parse(await after.json()).error.code).toBe('UNAUTHORIZED');

    const signIn = await t.request('POST', '/api/auth/sign-in/email', {
      json: { email: victim.email, password: victim.password },
      ip: t.nextIp(),
    });
    expect(signIn.status).toBe(403);
    expect(cookieHeader(signIn)).toBe('');

    const unban = await send('POST', `/api/admin/users/${victim.id}/unban`, adminCookie);
    expect(unban.status).toBe(200);
    expect(await t.signIn(victim)).not.toBe('');
  });

  test('a ban that left a session behind still blocks every request', async () => {
    const victim = await t.createUser({ label: 'lingering' });
    const cookie = await t.signIn(victim);
    // Set directly, so the session survives: the guard itself must notice the ban.
    const future = new Date(Date.now() + 3_600_000);
    await t.db.primary
      .update(userTable)
      .set({ banned: true, banExpires: future })
      .where(eq(userTable.id, victim.id));
    for (const path of ['/api/me', '/api/sites']) {
      const response = await get(path, cookie);
      expect(response.status, path).toBe(401);
    }
    // An expired ban no longer applies.
    await t.db.primary
      .update(userTable)
      .set({ banned: true, banExpires: new Date(Date.now() - 1000) })
      .where(eq(userTable.id, victim.id));
    expect((await get('/api/me', cookie)).status).toBe(200);
  });

  test('a revoked session is rejected at once', async () => {
    const victim = await t.createUser({ label: 'revoked' });
    const cookie = await t.signIn(victim);
    const revoke = await send('POST', `/api/admin/users/${victim.id}/revoke-sessions`, adminCookie);
    expect(revoke.status).toBe(200);
    expect((await get('/api/me', cookie)).status).toBe(401);
  });

  test('removing a membership takes effect on the next request, with the same session', async () => {
    const member = await t.createUser({ label: 'member' });
    const cookie = await t.signIn(member);
    expect((await get(`/api/sites/${site1.key}`, cookie)).status).toBe(404);
    const grant = await send('PUT', `/api/admin/users/${member.id}/sites`, adminCookie, {
      siteKeys: [site1.key],
    });
    expect(grant.status).toBe(200);
    expect((await get(`/api/sites/${site1.key}`, cookie)).status).toBe(200);
    const revoke = await send('PUT', `/api/admin/users/${member.id}/sites`, adminCookie, {
      siteKeys: [],
    });
    expect(revoke.status).toBe(200);
    expect((await get(`/api/sites/${site1.key}`, cookie)).status).toBe(404);
  });

  test('demoting an admin takes effect on the next request', async () => {
    const other = await t.createUser({ role: 'admin', label: 'admin2' });
    const cookie = await t.signIn(other);
    expect((await get('/api/admin/users', cookie)).status).toBe(200);
    const demote = await send('PATCH', `/api/admin/users/${other.id}`, adminCookie, {
      role: 'user',
    });
    expect(demote.status).toBe(200);
    expect((await get('/api/admin/users', cookie)).status).toBe(403);
  });

  /* mustChangePassword */

  test('mustChangePassword limits a user to /api/me, change-password and sign-out', async () => {
    const fresh = await t.createUser({ label: 'flagged', mustChangePassword: true });
    await t.db.primary
      .insert((await import('@consent/db')).siteMember)
      .values({ userId: fresh.id, siteId: site1.id });
    let cookie = await t.signIn(fresh);

    const me = (await (await get('/api/me', cookie)).json()) as { mustChangePassword: boolean };
    expect(me.mustChangePassword).toBe(true);

    for (const path of ['/api/sites', ...siteReadRoutes(site1.key)]) {
      const response = await get(path, cookie);
      expect(response.status, path).toBe(403);
      expect(apiErrorSchema.parse(await response.json()).error.code, path).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    }

    const wrong = await t.request('POST', '/api/auth/change-password', {
      cookie,
      json: { currentPassword: 'not-the-password', newPassword: 'a-brand-new-password-1' },
      ip: t.nextIp(),
    });
    expect(wrong.status).toBe(400);
    const tooShort = await t.request('POST', '/api/auth/change-password', {
      cookie,
      json: { currentPassword: fresh.password, newPassword: 'short' },
      ip: t.nextIp(),
    });
    expect(tooShort.status).toBe(400);
    expect(
      ((await (await get('/api/me', cookie)).json()) as { mustChangePassword: boolean })
        .mustChangePassword,
    ).toBe(true);

    const newPassword = 'a-brand-new-password-1';
    const changed = await t.request('POST', '/api/auth/change-password', {
      cookie,
      json: { currentPassword: fresh.password, newPassword, revokeOtherSessions: true },
      ip: t.nextIp(),
    });
    expect(changed.status).toBe(200);
    cookie = cookieHeader(changed) || cookie;

    expect(
      ((await (await get('/api/me', cookie)).json()) as { mustChangePassword: boolean })
        .mustChangePassword,
    ).toBe(false);
    expect((await get(`/api/sites/${site1.key}`, cookie)).status).toBe(200);
    expect((await get('/api/sites', cookie)).status).toBe(200);

    const oldPassword = await t.request('POST', '/api/auth/sign-in/email', {
      json: { email: fresh.email, password: fresh.password },
      ip: t.nextIp(),
    });
    expect(oldPassword.status).toBe(401);
    expect(await t.signIn({ email: fresh.email, password: newPassword })).not.toBe('');
  });

  test('a flagged admin cannot reach any admin route either', async () => {
    const flaggedAdmin = await t.createUser({
      role: 'admin',
      label: 'flagged-admin',
      mustChangePassword: true,
    });
    const cookie = await t.signIn(flaggedAdmin);
    for (const path of ['/api/admin/users', '/api/admin/sites', '/api/admin/audit']) {
      const response = await get(path, cookie);
      expect(response.status, path).toBe(403);
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    }
    const write = await send('POST', '/api/admin/users', cookie, {
      name: 'N',
      email: 'n@example.test',
    });
    expect(write.status).toBe(403);
    expect((await get('/api/me', cookie)).status).toBe(200);
  });

  test('sign-out is allowed while a password change is pending', async () => {
    const fresh = await t.createUser({ label: 'signout', mustChangePassword: true });
    const cookie = await t.signIn(fresh);
    const out = await t.request('POST', '/api/auth/sign-out', { cookie, json: {} });
    expect(out.status).toBe(200);
    expect((await get('/api/me', cookie)).status).toBe(401);
  });

  test('the session cookie is httpOnly, Secure and SameSite=Lax', async () => {
    const probe = await t.createUser({ label: 'cookie' });
    const response = await t.request('POST', '/api/auth/sign-in/email', {
      json: { email: probe.email, password: probe.password },
      ip: t.nextIp(),
    });
    const setCookie = response.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  test('login is rate limited per client IP', async () => {
    const probe = await t.createUser({ label: 'ratelimit' });
    const ip = t.nextIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await t.request('POST', '/api/auth/sign-in/email', {
        json: { email: probe.email, password: 'wrong-password-wrong' },
        ip,
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Another client IP is unaffected.
    expect(await t.signIn(probe)).not.toBe('');
  });
});

test('a role the platform does not know gets no access at all, on every guard', async () => {
  const session = (role: unknown) => ({
    user: { id: 'u-odd', name: 'Odd', email: 'odd@example.test', role, banned: false },
  });
  const appFor = (role: unknown) => {
    const auth = { api: { getSession: async () => session(role) } } as unknown as Auth;
    const authz = createAuthz({ auth, db: { primary: undefined as never } });
    return new Hono()
      .get('/session', authz.requireSession, (c) => c.json({ ok: true }))
      .get('/me', authz.requireSessionAllowingPasswordChange, (c) => c.json({ ok: true }))
      .get('/admin', authz.requireAdmin, (c) => c.json({ ok: true }))
      .get('/sites/:siteKey', authz.requireSiteAccess, (c) => c.json({ ok: true }))
      .onError(createErrorHandler(silentLogger));
  };

  for (const role of ['superuser', 'Admin', '', null, undefined, 1]) {
    const app = appFor(role);
    for (const path of ['/session', '/me', '/admin', '/sites/any-site']) {
      const response = await app.request(path);
      expect(response.status, `${String(role)} ${path}`).toBe(403);
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe('FORBIDDEN');
    }
  }
  // Control: a known role passes the same guards, so the 403 above is about the role alone.
  const known = appFor('user');
  expect((await known.request('/session')).status).toBe(200);
  expect((await known.request('/admin')).status).toBe(403);
});
