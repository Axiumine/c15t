// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { dbErrorCode } from './failover.js';
import { applyMigrations, type SqlExecutor } from './migrator.js';
import * as schema from './schema.js';

/*
 * Runs the real migration files in an in-process Postgres (PGlite), so constraints and triggers
 * are verified without touching the shared dev database. The session runs as a role that owns
 * the `app` schema but may not create schemas, like `dashboard` in production.
 */
const client = new PGlite();
const db = drizzle(client, { schema });
const { site, siteMember, adminAudit, user } = schema;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

function pgliteExecutor(
  runner: Pick<PGlite, 'query'> & Partial<Pick<PGlite, 'transaction'>>,
): SqlExecutor {
  return {
    query: async (text, params) =>
      (await runner.query<Record<string, unknown>>(text, params ? [...params] : [])).rows,
    transaction: async (run) => {
      if (runner.transaction === undefined) return run(pgliteExecutor(runner));
      return runner.transaction((tx) => run(pgliteExecutor(tx)));
    },
  };
}

let firstRun: { applied: number };

beforeAll(async () => {
  // What infra/postgres/init.sql sets up.
  await client.exec(`
    create role dashboard;
    create role c15t_api;
    create schema app authorization dashboard;
    revoke create on database postgres from public;
    set role dashboard;
  `);
  firstRun = await applyMigrations(pgliteExecutor(client), { migrationsFolder });
});

afterAll(async () => {
  await client.close();
});

describe('applyMigrations', () => {
  test('applies every migration once, then is a no-op', async () => {
    expect(firstRun.applied).toBe(2);
    await expect(applyMigrations(pgliteExecutor(client), { migrationsFolder })).resolves.toEqual({
      applied: 0,
    });
    const journal = await client.query('select count(*)::int as n from app.__drizzle_migrations');
    expect(journal.rows).toEqual([{ n: 2 }]);
  });

  test('works without CREATE on the database (no CREATE SCHEMA statement)', async () => {
    const created = await client.query("select 1 from pg_namespace where nspname = 'drizzle'");
    expect(created.rows).toHaveLength(0);
  });

  test('rejects unsafe journal identifiers', async () => {
    await expect(
      applyMigrations(pgliteExecutor(client), {
        migrationsFolder,
        table: 'x; drop table app.site',
      }),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });

  test('c15t_api can read the site registry and nothing else in app', async () => {
    const privileges = await client.query(
      `select
         has_table_privilege('c15t_api', 'app.site', 'SELECT') as site,
         has_table_privilege('c15t_api', 'app."user"', 'SELECT') as users,
         has_table_privilege('c15t_api', 'app.account', 'SELECT') as accounts,
         has_schema_privilege('c15t_api', 'app', 'USAGE') as usage`,
    );
    expect(privileges.rows).toEqual([{ site: true, users: false, accounts: false, usage: true }]);
  });
});

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return dbErrorCode(error);
  }
  return 'NO_ERROR';
}

const validSite = (key: string) => ({ key, name: key, domains: [`${key}.example.com`] });
const validUser = (id: string) => ({ id, name: id, email: `${id}@example.com` });

describe('site', () => {
  test('applies defaults', async () => {
    const [row] = await db.insert(site).values(validSite('shop')).returning();
    expect(row).toMatchObject({ key: 'shop', policyPreset: 'eu-opt-in', status: 'active' });
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('rejects a malformed key', async () => {
    for (const key of ['ab', 'Upper', 'under_score', 'a'.repeat(41)]) {
      expect(await codeOf(db.insert(site).values(validSite(key)))).toBe('23514');
    }
  });

  test('rejects duplicate keys', async () => {
    await db.insert(site).values(validSite('dupe'));
    expect(await codeOf(db.insert(site).values(validSite('dupe')))).toBe('23505');
  });

  test('rejects empty or wildcard domains', async () => {
    expect(await codeOf(db.insert(site).values({ ...validSite('empty-dom'), domains: [] }))).toBe(
      '23514',
    );
    expect(await codeOf(db.insert(site).values({ ...validSite('star-all'), domains: ['*'] }))).toBe(
      '23514',
    );
    expect(
      await codeOf(
        db.insert(site).values({ ...validSite('star-sub'), domains: ['*.example.com'] }),
      ),
    ).toBe('23514');
  });

  test('rejects an unknown preset or status', async () => {
    expect(
      await codeOf(db.insert(site).values({ ...validSite('bad-preset'), policyPreset: 'nope' })),
    ).toBe('23514');
    expect(
      await codeOf(db.insert(site).values({ ...validSite('bad-status'), status: 'deleted' })),
    ).toBe('23514');
  });

  test('the key is immutable but other columns can change', async () => {
    await db.insert(site).values(validSite('immutable'));
    expect(
      await codeOf(db.update(site).set({ key: 'renamed' }).where(eq(site.key, 'immutable'))),
    ).toBe('23514');
    await db
      .update(site)
      .set({ name: 'New name', status: 'disabled' })
      .where(eq(site.key, 'immutable'));
    const [row] = await db.select().from(site).where(eq(site.key, 'immutable'));
    expect(row).toMatchObject({ name: 'New name', status: 'disabled' });
  });

  test('inserts and updates notify site_changed with the key', async () => {
    const received: string[] = [];
    const unlisten = await client.listen('site_changed', (payload) => received.push(payload));
    await db.insert(site).values(validSite('notify-me'));
    await db.update(site).set({ name: 'Changed' }).where(eq(site.key, 'notify-me'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await unlisten();
    expect(received).toEqual(['notify-me', 'notify-me']);
  });
});

describe('user and membership', () => {
  test('only admin and user roles, lowercase email', async () => {
    expect(await codeOf(db.insert(user).values({ ...validUser('bad-role'), role: 'root' }))).toBe(
      '23514',
    );
    expect(
      await codeOf(db.insert(user).values({ ...validUser('Upper'), email: 'Upper@Example.com' })),
    ).toBe('23514');
    const [row] = await db.insert(user).values(validUser('plain')).returning();
    expect(row).toMatchObject({ role: 'user', banned: false, mustChangePassword: false });
  });

  test('membership cascades with the user and restricts site deletion', async () => {
    const [u] = await db.insert(user).values(validUser('member-u')).returning();
    const [s] = await db.insert(site).values(validSite('member-site')).returning();
    if (u === undefined || s === undefined) throw new Error('setup failed');
    await db.insert(siteMember).values({ userId: u.id, siteId: s.id });
    expect(await codeOf(db.insert(siteMember).values({ userId: u.id, siteId: s.id }))).toBe(
      '23505',
    );
    expect(await codeOf(db.delete(site).where(eq(site.id, s.id)))).toBe('23001');
    await db.delete(user).where(eq(user.id, u.id));
    const rows = await db.select().from(siteMember).where(eq(siteMember.siteId, s.id));
    expect(rows).toHaveLength(0);
  });
});

describe('admin_audit', () => {
  const entry = {
    actorId: 'a1',
    actorEmail: 'admin@example.com',
    action: 'site.create',
    targetType: 'site',
    targetId: 'shop',
    metadata: { domains: ['shop.example.com'] },
    ip: '203.0.113.7',
  };

  test('accepts rows and stores jsonb metadata', async () => {
    const [row] = await db.insert(adminAudit).values(entry).returning();
    expect(row?.metadata).toEqual(entry.metadata);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  test('rejects unknown actions and target types', async () => {
    expect(await codeOf(db.insert(adminAudit).values({ ...entry, action: 'site.delete' }))).toBe(
      '23514',
    );
    expect(await codeOf(db.insert(adminAudit).values({ ...entry, targetType: 'consent' }))).toBe(
      '23514',
    );
  });

  test('is append-only: update, delete and truncate are refused', async () => {
    await db.insert(adminAudit).values(entry);
    expect(await codeOf(db.update(adminAudit).set({ action: 'site.update' }))).toBe('55000');
    expect(await codeOf(db.delete(adminAudit))).toBe('55000');
    expect(await codeOf(db.execute(sql`truncate app.admin_audit`))).toBe('55000');
  });
});
