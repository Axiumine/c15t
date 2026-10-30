// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { account, adminAudit, user as userTable } from '@consent/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AdminExistsError, createAdmin } from './bootstrap.js';
import { createTestApp, type TestApp } from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

describeEnvironments('admin:create bootstrap', ({ env }) => {
  let t: TestApp;
  const email = () => `${env().prefix}-bootstrap@example.test`;

  beforeAll(() => {
    t = createTestApp(env());
  });
  afterAll(async () => {
    await t?.close();
  });

  test('creates an administrator with a one-time password that must be changed', async () => {
    const result = await createAdmin(
      { db: t.db, auth: t.auth },
      { email: email().toUpperCase(), name: 'First Admin' },
    );
    expect(result.email).toBe(email());
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
    const [row] = await t.db.primary.select().from(userTable).where(eq(userTable.email, email()));
    const audit = await t.db.primary
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.targetId, row?.id ?? ''));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'user.create', actorId: null });
    expect(audit[0]?.metadata).toEqual({ email: email(), role: 'admin', source: 'cli' });
  });

  test('refuses an email that already exists, in any letter case', async () => {
    await expect(
      createAdmin({ db: t.db, auth: t.auth }, { email: email().toUpperCase() }),
    ).rejects.toBeInstanceOf(AdminExistsError);
    const rows = await t.db.primary.select().from(userTable).where(eq(userTable.email, email()));
    expect(rows).toHaveLength(1);
  });

  test('rejects an invalid email and derives a name from the address', async () => {
    await expect(createAdmin({ db: t.db, auth: t.auth }, { email: 'nope' })).rejects.toThrow();
    const result = await createAdmin(
      { db: t.db, auth: t.auth },
      { email: `${env().prefix}-nameless@example.test` },
    );
    const [row] = await t.db.primary
      .select()
      .from(userTable)
      .where(eq(userTable.id, result.userId));
    expect(row?.name).toBe(`${env().prefix}-nameless`);
  });
});
