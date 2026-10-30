// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { account, adminAudit, user as userTable } from '@consent/db';
import {
  apiErrorSchema,
  auditPageSchema,
  oneTimePasswordResultSchema,
  PASSWORD_MIN_LENGTH,
  siteSchema,
  userSummarySchema,
} from '@consent/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createTestApp, type TestApp, type TestUser } from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

describeEnvironments('admin routes', ({ env, kind }) => {
  let t: TestApp;
  let admin: TestUser;
  let adminCookie: string;
  let adminIp: string;
  const notifications: string[] = [];
  let stopListening: () => Promise<void>;

  const send = (method: string, path: string, json?: unknown, cookie = adminCookie) =>
    t.request(method, path, { cookie, ip: adminIp, ...(json === undefined ? {} : { json }) });
  const key = (label: string) => `${env().prefix}-${label}`;
  const email = (label: string) => `${env().prefix}-${label}@example.test`;
  const auditOf = (targetId: string) =>
    t.db.primary
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.targetId, targetId))
      .orderBy(asc(adminAudit.createdAt));
  const mine = () => notifications.filter((payload) => payload.startsWith(env().prefix));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  beforeAll(async () => {
    t = createTestApp(env());
    admin = await t.createUser({ role: 'admin', label: 'root' });
    adminCookie = await t.signIn(admin);
    adminIp = '203.0.113.250';
    stopListening = await env().listen('site_changed', (payload) => notifications.push(payload));
  }, 120_000);

  afterAll(async () => {
    await stopListening?.();
    await t?.close();
  });

  /* Sites */

  test('creates a site: shape, audit row with actor and IP, one NOTIFY', async () => {
    const siteKey = key('shop');
    const response = await send('POST', '/api/admin/sites', {
      key: siteKey,
      name: 'Shop',
      domains: ['Shop.Example.Test', 'www.shop.example.test'],
      policyPreset: 'eu-us-opt-out',
    });
    expect(response.status).toBe(201);
    const created = siteSchema.parse(await response.json());
    expect(created).toMatchObject({
      key: siteKey,
      name: 'Shop',
      domains: ['shop.example.test', 'www.shop.example.test'],
      policyPreset: 'eu-us-opt-out',
      status: 'active',
    });
    const [entry, ...rest] = await auditOf(siteKey);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      action: 'site.create',
      targetType: 'site',
      actorId: admin.id,
      actorEmail: admin.email,
      ip: adminIp,
    });
    await vi.waitFor(() => expect(mine()).toEqual([siteKey]));
  });

  test('a duplicate key is a 409 and leaves no audit row', async () => {
    const siteKey = key('dup');
    const body = { key: siteKey, name: 'Dup', domains: ['dup.example.test'] };
    expect((await send('POST', '/api/admin/sites', body)).status).toBe(201);
    const again = await send('POST', '/api/admin/sites', body);
    expect(again.status).toBe(409);
    expect(apiErrorSchema.parse(await again.json()).error.code).toBe('SITE_KEY_TAKEN');
    expect(await auditOf(siteKey)).toHaveLength(1);
  });

  test.each([
    ['a wildcard domain', { key: 'wild-1', name: 'W', domains: ['*.example.test'] }],
    ['an empty domain list', { key: 'wild-2', name: 'W', domains: [] }],
    ['an upper-case key', { key: 'UPPER', name: 'W', domains: ['a.example.test'] }],
    ['a short key', { key: 'ab', name: 'W', domains: ['a.example.test'] }],
    ['a domain with a scheme', { key: 'wild-3', name: 'W', domains: ['https://a.example.test'] }],
    [
      'an unknown field',
      { key: 'wild-4', name: 'W', domains: ['a.example.test'], status: 'disabled' },
    ],
    ['a missing name', { key: 'wild-5', domains: ['a.example.test'] }],
  ])('rejects %s with a field-level validation error', async (_name, body) => {
    const response = await send('POST', '/api/admin/sites', body);
    expect(response.status).toBe(400);
    const error = apiErrorSchema.parse(await response.json()).error;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  test('edits and disables a site, one audit row per kind of change, NOTIFY per change', async () => {
    const siteKey = key('edit');
    await send('POST', '/api/admin/sites', {
      key: siteKey,
      name: 'Edit',
      domains: ['edit.example.test'],
    });
    await settle();
    notifications.length = 0;

    const renamed = await send('PATCH', `/api/admin/sites/${siteKey}`, {
      name: 'Renamed',
      domains: ['edit.example.test', 'edit2.example.test'],
      policyPreset: 'global-preferences',
    });
    expect(renamed.status).toBe(200);
    expect(siteSchema.parse(await renamed.json())).toMatchObject({
      name: 'Renamed',
      policyPreset: 'global-preferences',
      domains: ['edit.example.test', 'edit2.example.test'],
    });

    const disabled = await send('PATCH', `/api/admin/sites/${siteKey}`, { status: 'disabled' });
    expect(siteSchema.parse(await disabled.json()).status).toBe('disabled');
    const enabled = await send('PATCH', `/api/admin/sites/${siteKey}`, { status: 'active' });
    expect(siteSchema.parse(await enabled.json()).status).toBe('active');

    const both = await send('PATCH', `/api/admin/sites/${siteKey}`, {
      name: 'Both',
      status: 'disabled',
    });
    expect(both.status).toBe(200);

    const actions = (await auditOf(siteKey)).map((entry) => entry.action);
    expect(actions).toEqual([
      'site.create',
      'site.update',
      'site.disable',
      'site.enable',
      'site.update',
      'site.disable',
    ]);
    const updateEntry = (await auditOf(siteKey))[1];
    expect(updateEntry?.metadata).toEqual({
      changes: {
        name: { from: 'Edit', to: 'Renamed' },
        domains: { from: ['edit.example.test'], to: ['edit.example.test', 'edit2.example.test'] },
        policyPreset: { from: 'eu-opt-in', to: 'global-preferences' },
      },
    });
    await vi.waitFor(() => expect(mine()).toEqual([siteKey, siteKey, siteKey, siteKey]));
  });

  test('a PATCH that changes nothing writes no audit row and sends no NOTIFY', async () => {
    const siteKey = key('noop');
    await send('POST', '/api/admin/sites', {
      key: siteKey,
      name: 'Noop',
      domains: ['noop.example.test'],
    });
    await settle();
    notifications.length = 0;
    const response = await send('PATCH', `/api/admin/sites/${siteKey}`, {
      name: 'Noop',
      domains: ['noop.example.test'],
      status: 'active',
    });
    expect(response.status).toBe(200);
    await settle();
    expect(await auditOf(siteKey)).toHaveLength(1);
    expect(mine()).toEqual([]);
  });

  test('the site key cannot be changed, and unknown sites are 404', async () => {
    const siteKey = key('immutable');
    await send('POST', '/api/admin/sites', {
      key: siteKey,
      name: 'Imm',
      domains: ['imm.example.test'],
    });
    const change = await send('PATCH', `/api/admin/sites/${siteKey}`, { key: key('other') });
    expect(change.status).toBe(400);
    const empty = await send('PATCH', `/api/admin/sites/${siteKey}`, {});
    expect(empty.status).toBe(400);
    const missing = await send('PATCH', `/api/admin/sites/${key('missing')}`, { name: 'x' });
    expect(missing.status).toBe(404);
  });

  test('sites cannot be deleted', async () => {
    const siteKey = key('keep');
    await send('POST', '/api/admin/sites', {
      key: siteKey,
      name: 'Keep',
      domains: ['keep.example.test'],
    });
    const response = await send('DELETE', `/api/admin/sites/${siteKey}`);
    expect(response.status).toBe(404);
    const list = (await (await send('GET', '/api/admin/sites')).json()) as {
      items: { key: string }[];
    };
    expect(list.items.map((item) => item.key)).toContain(siteKey);
  });

  /* Users */

  test('creates a user with a one-time password that is stored only as a hash', async () => {
    const out: string[] = [];
    const capture = (chunk: unknown) => {
      out.push(String(chunk));
      return true;
    };
    const captureArgs = (...args: unknown[]) => {
      out.push(args.join(' '));
    };
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation(capture),
      vi.spyOn(process.stderr, 'write').mockImplementation(capture),
      vi.spyOn(console, 'log').mockImplementation(captureArgs),
      vi.spyOn(console, 'warn').mockImplementation(captureArgs),
      vi.spyOn(console, 'error').mockImplementation(captureArgs),
    ];
    const siteKey = key('members');
    await send('POST', '/api/admin/sites', {
      key: siteKey,
      name: 'M',
      domains: ['m.example.test'],
    });

    let created: ReturnType<typeof oneTimePasswordResultSchema.parse>;
    try {
      const response = await send('POST', '/api/admin/users', {
        name: 'New Person',
        email: email('New.Person').toUpperCase(),
        siteKeys: [siteKey],
      });
      expect(response.status).toBe(201);
      created = oneTimePasswordResultSchema.parse(await response.json());
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const password = created.oneTimePassword;
    expect(password.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(created.user).toMatchObject({
      email: email('new.person'),
      role: 'user',
      mustChangePassword: true,
      banned: false,
      siteKeys: [siteKey],
    });
    userSummarySchema.parse(created.user);

    // Not in any log line, not in the output streams, not in the audit trail, only hashed in the DB.
    expect(t.logs.join('\n')).not.toContain(password);
    expect(out.join('\n')).not.toContain(password);
    const audit = await auditOf(created.user.id);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(audit[0]).toMatchObject({ action: 'user.create', actorId: admin.id });
    expect(audit[0]?.metadata).toEqual({
      email: email('new.person'),
      role: 'user',
      siteKeys: [siteKey],
    });
    const [stored] = await t.db.primary
      .select()
      .from(account)
      .where(eq(account.userId, created.user.id));
    expect(stored?.password).toBeTruthy();
    expect(stored?.password).not.toBe(password);
    expect(stored?.password).not.toContain(password);

    // It works once, and it forces a change.
    const cookie = await t.signIn({ email: created.user.email, password });
    const me = (await (await t.request('GET', '/api/me', { cookie })).json()) as {
      mustChangePassword: boolean;
    };
    expect(me.mustChangePassword).toBe(true);
    // The password is never returned again.
    const list = await (await send('GET', '/api/admin/users')).text();
    expect(list).not.toContain(password);
  });

  test('refuses a duplicate email and an unknown site key, and creates nothing', async () => {
    const duplicate = await send('POST', '/api/admin/users', { name: 'Dup', email: admin.email });
    expect(duplicate.status).toBe(409);
    expect(apiErrorSchema.parse(await duplicate.json()).error.code).toBe('EMAIL_TAKEN');

    const ghostEmail = email('ghost');
    const unknown = await send('POST', '/api/admin/users', {
      name: 'Ghost',
      email: ghostEmail,
      siteKeys: [key('no-such-site')],
    });
    expect(unknown.status).toBe(400);
    expect(apiErrorSchema.parse(await unknown.json()).error.code).toBe('VALIDATION_ERROR');
    const rows = await t.db.primary.select().from(userTable).where(eq(userTable.email, ghostEmail));
    expect(rows).toEqual([]);
  });

  test.each([
    ['an invalid email', { name: 'X', email: 'not-an-email' }],
    [
      'an unknown field (a chosen password)',
      { name: 'X', email: 'x@example.test', password: 'chosen-by-admin-1' },
    ],
    ['an invalid role', { name: 'X', email: 'x@example.test', role: 'owner' }],
    ['a missing name', { email: 'x@example.test' }],
  ])('rejects user creation with %s', async (_name, body) => {
    const response = await send('POST', '/api/admin/users', body);
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  test('resets a password: new one-time password, forced change, sessions revoked, audited', async () => {
    const target = await t.createUser({ label: 'reset' });
    const oldCookie = await t.signIn(target);
    const response = await send('POST', `/api/admin/users/${target.id}/reset-password`);
    expect(response.status).toBe(200);
    const result = oneTimePasswordResultSchema.parse(await response.json());
    expect(result.oneTimePassword).not.toBe(target.password);
    expect(result.user.mustChangePassword).toBe(true);

    expect((await t.request('GET', '/api/me', { cookie: oldCookie })).status).toBe(401);
    const stale = await t.request('POST', '/api/auth/sign-in/email', {
      json: { email: target.email, password: target.password },
      ip: t.nextIp(),
    });
    expect(stale.status).toBe(401);
    const cookie = await t.signIn({ email: target.email, password: result.oneTimePassword });
    expect(
      (
        (await (await t.request('GET', '/api/me', { cookie })).json()) as {
          mustChangePassword: boolean;
        }
      ).mustChangePassword,
    ).toBe(true);

    const audit = await auditOf(target.id);
    expect(audit.map((entry) => entry.action)).toEqual(['user.reset-password']);
    expect(JSON.stringify(audit)).not.toContain(result.oneTimePassword);
    expect(t.logs.join('\n')).not.toContain(result.oneTimePassword);
  });

  test('an admin cannot reset or ban their own account through the admin API', async () => {
    const reset = await send('POST', `/api/admin/users/${admin.id}/reset-password`);
    expect(reset.status).toBe(400);
    const ban = await send('POST', `/api/admin/users/${admin.id}/ban`, {});
    expect(ban.status).toBe(400);
    expect((await t.request('GET', '/api/me', { cookie: adminCookie })).status).toBe(200);
  });

  test('ban, unban and revoke-sessions are audited with their details', async () => {
    const target = await t.createUser({ label: 'moderated' });
    const ban = await send('POST', `/api/admin/users/${target.id}/ban`, {
      reason: 'abuse',
      expiresInSeconds: 3600,
    });
    const banned = userSummarySchema.parse(await ban.json());
    expect(banned).toMatchObject({ banned: true, banReason: 'abuse' });
    expect(banned.banExpires).not.toBeNull();
    await send('POST', `/api/admin/users/${target.id}/unban`);
    await send('POST', `/api/admin/users/${target.id}/revoke-sessions`);
    const audit = await auditOf(target.id);
    expect(audit.map((entry) => entry.action)).toEqual([
      'user.ban',
      'user.unban',
      'user.revoke-sessions',
    ]);
    expect(audit[0]?.metadata).toEqual({ reason: 'abuse', expiresInSeconds: 3600 });
  });

  test('sets the sites of a user as a complete set, audited with before and after', async () => {
    const target = await t.createUser({ label: 'sites' });
    const s1 = await t.createSite({ label: 'set-a' });
    const s2 = await t.createSite({ label: 'set-b' });
    const first = await send('PUT', `/api/admin/users/${target.id}/sites`, {
      siteKeys: [s1.key, s2.key],
    });
    expect(userSummarySchema.parse(await first.json()).siteKeys).toEqual([s1.key, s2.key].sort());
    const second = await send('PUT', `/api/admin/users/${target.id}/sites`, { siteKeys: [s2.key] });
    expect(userSummarySchema.parse(await second.json()).siteKeys).toEqual([s2.key]);
    await send('PUT', `/api/admin/users/${target.id}/sites`, { siteKeys: [s2.key] });

    const audit = await auditOf(target.id);
    expect(audit.map((entry) => entry.action)).toEqual(['user.set-sites', 'user.set-sites']);
    expect(audit[1]?.metadata).toEqual({ before: [s1.key, s2.key].sort(), after: [s2.key] });

    const unknown = await send('PUT', `/api/admin/users/${target.id}/sites`, {
      siteKeys: [s1.key, key('nope')],
    });
    expect(unknown.status).toBe(400);
    const unchanged = await send('GET', '/api/admin/users');
    const row = (
      (await unchanged.json()) as { items: { id: string; siteKeys: string[] }[] }
    ).items.find((u) => u.id === target.id);
    expect(row?.siteKeys).toEqual([s2.key]);
  });

  test('edits name and role, audited', async () => {
    const target = await t.createUser({ label: 'edited' });
    const response = await send('PATCH', `/api/admin/users/${target.id}`, {
      name: 'Edited Name',
      role: 'admin',
    });
    expect(userSummarySchema.parse(await response.json())).toMatchObject({
      name: 'Edited Name',
      role: 'admin',
    });
    const [entry] = await auditOf(target.id);
    expect(entry).toMatchObject({ action: 'user.update' });
    expect(entry?.metadata).toEqual({
      changes: {
        name: { from: 'Test user', to: 'Edited Name' },
        role: { from: 'user', to: 'admin' },
      },
    });
    const again = await send('PATCH', `/api/admin/users/${target.id}`, { name: 'Edited Name' });
    expect(again.status).toBe(200);
    expect(await auditOf(target.id)).toHaveLength(1);
    expect(
      (await send('PATCH', `/api/admin/users/${key('missing-user')}`, { name: 'x' })).status,
    ).toBe(404);
  });

  test('unknown users are 404 on every user action', async () => {
    const ghost = `${env().prefix}-ghost-user`;
    for (const [method, path, body] of [
      ['POST', `/api/admin/users/${ghost}/reset-password`],
      ['POST', `/api/admin/users/${ghost}/ban`, {}],
      ['POST', `/api/admin/users/${ghost}/unban`],
      ['POST', `/api/admin/users/${ghost}/revoke-sessions`],
      ['PUT', `/api/admin/users/${ghost}/sites`, { siteKeys: [] }],
    ] as const) {
      expect((await send(method, path, body)).status, path).toBe(404);
    }
  });

  /* Audit log */

  const auditPage = async (cursor: string | undefined) => {
    const query = `limit=3${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    const response = await send('GET', `/api/admin/audit?${query}`);
    expect(response.status).toBe(200);
    return auditPageSchema.parse(await response.json());
  };

  test('lists the audit log newest first with a cursor', async () => {
    const seen: { id: string; createdAt: string; targetId: string }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 40; page++) {
      const body = await auditPage(cursor);
      expect(body.items.length).toBeLessThanOrEqual(3);
      seen.push(...body.items);
      cursor = body.nextCursor ?? undefined;
      // Stop once this run's first entry (the first site created) has been paged through.
      if (cursor === undefined || seen.some((item) => item.targetId === key('shop'))) break;
    }
    expect(new Set(seen.map((item) => item.id)).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(3);
    const times = seen.map((item) => item.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  test('rejects a forged audit cursor', async () => {
    expect((await send('GET', '/api/admin/audit?cursor=Zm9yZ2Vk')).status).toBe(400);
    expect((await send('GET', '/api/admin/audit?limit=0')).status).toBe(400);
    expect((await send('GET', '/api/admin/audit?limit=201')).status).toBe(400);
  });

  /* Transactions (a failing audit insert must undo the change it describes) */

  test.runIf(kind === 'pglite')(
    'a failing audit insert rolls back the change, user or site',
    async () => {
      await t.db.primary.execute(sql`
      create function app.test_fail_audit() returns trigger language plpgsql as $$
      begin
        if new.metadata->>'email' like '%-rollback@%' or new.metadata->>'name' = 'rollback' then
          raise exception 'injected audit failure';
        end if;
        return new;
      end $$`);
      await t.db.primary.execute(
        sql`create trigger test_fail_audit before insert on app.admin_audit for each row execute function app.test_fail_audit()`,
      );
      try {
        await settle();
        notifications.length = 0;
        const rollbackEmail = email('rollback');
        const accountsBefore = (await t.db.primary.select().from(account)).length;
        const userResponse = await send('POST', '/api/admin/users', {
          name: 'Rollback',
          email: rollbackEmail,
        });
        expect(userResponse.status).toBe(500);
        expect(apiErrorSchema.parse(await userResponse.json()).error.message).not.toMatch(
          /audit|trigger|injected/i,
        );
        // Neither the user nor its credential account survived.
        expect(
          await t.db.primary.select().from(userTable).where(eq(userTable.email, rollbackEmail)),
        ).toEqual([]);
        expect(await t.db.primary.select().from(account)).toHaveLength(accountsBefore);

        const siteKey = key('rollback-site');
        const siteResponse = await send('POST', '/api/admin/sites', {
          key: siteKey,
          name: 'rollback',
          domains: ['r.example.test'],
        });
        expect(siteResponse.status).toBe(500);
        const sites = (await (await send('GET', '/api/admin/sites')).json()) as {
          items: { key: string }[];
        };
        expect(sites.items.map((item) => item.key)).not.toContain(siteKey);
        expect(await auditOf(siteKey)).toEqual([]);
        await settle();
        expect(mine()).toEqual([]);
      } finally {
        await t.db.primary.execute(sql`drop trigger test_fail_audit on app.admin_audit`);
        await t.db.primary.execute(sql`drop function app.test_fail_audit()`);
      }
    },
  );

  test('every admin response is JSON and never leaks SQL or stack traces', async () => {
    const attempts = await Promise.all([
      send('POST', '/api/admin/sites', {
        key: key('leak'),
        name: 'x'.repeat(200),
        domains: ['a.example.test'],
      }),
      send('PATCH', `/api/admin/sites/${key('leak')}`, { domains: ['*'] }),
      send('GET', `/api/admin/audit?cursor=${'A'.repeat(600)}`),
    ]);
    for (const response of attempts) {
      const text = await response.text();
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(text).not.toMatch(/select |insert |"app"|at .*\.ts|node_modules|stack/i);
    }
  });
});

describeEnvironments(
  'last administrator',
  ({ env }) => {
    let t: TestApp;

    beforeAll(() => {
      t = createTestApp(env());
    });
    afterAll(async () => {
      await t?.close();
    });

    // Needs a database where this test owns every administrator, so it never runs on the shared one.
    test('the only active administrator cannot demote themselves; with two they can', async () => {
      const first = await t.createUser({ role: 'admin', label: 'first' });
      const cookie = await t.signIn(first);
      const demote = (id: string, as: string) =>
        t.request('PATCH', `/api/admin/users/${id}`, { cookie: as, json: { role: 'user' } });

      const refused = await demote(first.id, cookie);
      expect(refused.status).toBe(409);
      expect(apiErrorSchema.parse(await refused.json()).error.code).toBe('LAST_ADMIN');
      const rows = await t.db.primary.select().from(userTable).where(eq(userTable.id, first.id));
      expect(rows[0]?.role).toBe('admin');

      const second = await t.createUser({ role: 'admin', label: 'second' });
      const secondCookie = await t.signIn(second);
      expect((await demote(first.id, cookie)).status).toBe(200);
      const again = await demote(second.id, secondCookie);
      expect(again.status).toBe(409);
      expect((await t.request('GET', '/api/admin/users', { cookie: secondCookie })).status).toBe(
        200,
      );
    });
  },
  ['pglite'],
);
