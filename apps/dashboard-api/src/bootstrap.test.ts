// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { account, adminAudit, user as userTable } from '@consent/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { AdminExistsError, createAdmin } from './bootstrap.js';
import { createTestApp, type TestApp } from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

describeEnvironments('admin:create bootstrap', ({ env }) => {
  let t: TestApp;
  const email = (label: string) => `${env().prefix}-${label}@example.test`;
  // Users a test created, removed after it so no test depends on another's rows.
  let created: string[] = [];

  /** Bootstraps an administrator that only the calling test uses. */
  const bootstrap = async (label: string, name?: string) => {
    const result = await createAdmin({ db: t.db, auth: t.auth }, { email: email(label), name });
    created.push(result.userId);
    return result;
  };

  beforeAll(() => {
    t = createTestApp(env());
  });
  afterEach(async () => {
    // Accounts and sessions go with the user (cascade); `admin_audit` is append-only.
    if (created.length > 0)
      await t.db.primary.delete(userTable).where(inArray(userTable.id, created));
    created = [];
  });
  afterAll(async () => {
    await t?.close();
  });

  test('creates an administrator with a one-time password that must be changed', async () => {
    const result = await createAdmin(
      { db: t.db, auth: t.auth },
      { email: email('first').toUpperCase(), name: 'First Admin' },
    );
    created.push(result.userId);
    expect(result.email).toBe(email('first'));
    expect(result.oneTimePassword.length).toBeGreaterThanOrEqual(12);

    const [row] = await t.db.primary
      .select()
      .from(userTable)
      .where(eq(userTable.id, result.userId));
    expect(row).toMatchObject({
      role: 'admin',
      mustChangePassword: true,
      name: 'First Admin',
      banned: false,
    });

    const [stored] = await t.db.primary
      .select()
      .from(account)
      .where(eq(account.userId, result.userId));
    expect(stored?.password).toBeTruthy();
    expect(stored?.password).not.toContain(result.oneTimePassword);

    const cookie = await t.signIn({ email: result.email, password: result.oneTimePassword });
    const me = (await (await t.request('GET', '/api/me', { cookie })).json()) as {
      role: string;
      mustChangePassword: boolean;
    };
    expect(me).toMatchObject({ role: 'admin', mustChangePassword: true });
    // Until the password is changed, the admin API stays closed.
    expect((await t.request('GET', '/api/admin/users', { cookie })).status).toBe(403);
  });

  test('records the bootstrap in the audit log without the password', async () => {
    const { userId } = await bootstrap('audited');
    const audit = await t.db.primary
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.targetId, userId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'user.create', actorId: null });
    expect(audit[0]?.metadata).toEqual({ email: email('audited'), role: 'admin', source: 'cli' });
  });

  test('refuses an email that already exists, in any letter case', async () => {
    await bootstrap('taken');
    await expect(
      createAdmin({ db: t.db, auth: t.auth }, { email: email('taken').toUpperCase() }),
    ).rejects.toBeInstanceOf(AdminExistsError);
    const rows = await t.db.primary
      .select()
      .from(userTable)
      .where(eq(userTable.email, email('taken')));
    expect(rows).toHaveLength(1);
  });

  test('rejects an invalid email and derives a name from the address', async () => {
    await expect(createAdmin({ db: t.db, auth: t.auth }, { email: 'nope' })).rejects.toThrow();
    const result = await bootstrap('nameless');
    const [row] = await t.db.primary
      .select()
      .from(userTable)
      .where(eq(userTable.id, result.userId));
    expect(row?.name).toBe(`${env().prefix}-nameless`);
  });

  test('a blank name is replaced by the part of the address before the @', async () => {
    const result = await bootstrap('blank', '   ');
    const [row] = await t.db.primary
      .select()
      .from(userTable)
      .where(eq(userTable.id, result.userId));
    expect(row?.name).toBe(`${env().prefix}-blank`);
  });
});
