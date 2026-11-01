// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  account,
  adminAudit,
  applyMigrations,
  createDatabase,
  createPool,
  type Database,
  rateLimit,
  type SqlExecutor,
  session,
  site,
  siteMember,
  user,
  verification,
} from '@consent/db';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabasePools } from '../db.js';
import { C15T_DDL } from './c15t-ddl.js';

/*
 * Two interchangeable databases for the integration tests:
 * - `pglite`: an in-process Postgres with the real `app` migrations and the c15t DDL. Always
 *   available, never touches shared state.
 * - `postgres`: the shared dev database (DATABASE_URL_DASHBOARD for the app, DATABASE_URL_C15T
 *   to seed c15t rows, because the dashboard role is read-only on that schema). A missing
 *   variable is an error, never a skip.
 * Every row a test creates carries the run prefix, and cleanup deletes only rows with it.
 */

export type EnvironmentKind = 'pglite' | 'postgres';

export interface ConsentFixture {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly externalId?: string;
  readonly domain: string;
  /** Naive UTC, as c15t stores it: `2026-03-01 12:00:00`. */
  readonly givenAt: string;
  /** Category to granted, stored as c15t 3.x receipts. */
  readonly choice?: Readonly<Record<string, boolean>> | null;
  /** Codes stored only in `purposeIds` (rows written by older c15t versions). */
  readonly legacyPurposes?: readonly string[];
  readonly jurisdiction?: string;
  readonly countryCode?: string;
  readonly regionCode?: string;
  readonly userAgent?: string;
  readonly id?: string;
}

export interface TestEnvironment {
  readonly kind: EnvironmentKind;
  readonly pools: DatabasePools;
  /** Unique per run (`dapi-` and 64 random bits), safe in site keys and emails. */
  readonly prefix: string;
  seedConsents(rows: readonly ConsentFixture[]): Promise<void>;
  /** LISTENs on a channel; the returned function stops listening. */
  listen(channel: string, onMessage: (payload: string) => void): Promise<() => Promise<void>>;
  /** Removes the rows this run created from the app and c15t schemas. */
  cleanup(): Promise<void>;
  close(): Promise<void>;
}

type Exec = (text: string, params?: readonly unknown[]) => Promise<void>;

const MIGRATIONS = fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url));
const INSERT_CHUNK = 150;

const PREFIX_PATTERN = /^dapi-[0-9a-f]{16}$/;

/**
 * Not a short or generic stem like `t-`: other suites share the dev database, and a cleanup of
 * theirs (or ours) must never be able to match rows that belong to another run.
 */
function newPrefix(): string {
  return `dapi-${randomBytes(8).toString('hex')}`;
}

/** Cleanup deletes with `LIKE prefix-%`, so a malformed prefix must never reach it. */
function assertRunPrefix(prefix: string): void {
  if (!PREFIX_PATTERN.test(prefix)) throw new Error('Refusing to clean up with a malformed prefix');
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function receipts(choice: Readonly<Record<string, boolean>>): string {
  const categories = Object.fromEntries(
    Object.entries(choice).map(([name, value]) => [
      name,
      { value, confirmedAt: 1_700_000_000_000, basis: { kind: 'legacy-v2' } },
    ]),
  );
  return json({ categories, version: 3 });
}

interface Table {
  readonly name: string;
  readonly columns: readonly string[];
}

/*
 * postgres.js re-encodes a string bound to a typed parameter: for `timestamp` it goes through
 * `new Date(text).toISOString()`, which reads the text in the PROCESS time zone and moves it by
 * the zone offset; for `json` it goes through `JSON.stringify`, which stores a JSON string
 * scalar instead of the object (so the stats SQL finds no categories). PGlite does neither. The
 * values are therefore bound as text and cast in SQL, which stores them exactly as written.
 * c15t timestamps are `timestamp without time zone` holding UTC.
 */
const TIMESTAMP_COLUMNS: ReadonlySet<string> = new Set(['createdAt', 'updatedAt', 'givenAt']);

/** `$n`, cast from text where the column type needs it (see the comment above). */
function placeholder(column: string, position: number, jsonColumns: readonly string[]): string {
  if (jsonColumns.includes(column)) return `$${position}::text::json`;
  if (TIMESTAMP_COLUMNS.has(column)) return `$${position}::text::timestamp`;
  return `$${position}`;
}

/** Multi-row INSERT ... ON CONFLICT DO NOTHING, in chunks. `jsonColumns` get a ::text::json cast. */
async function insertRows(
  exec: Exec,
  table: Table,
  rows: readonly (readonly unknown[])[],
  jsonColumns: readonly string[] = [],
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const chunk = rows.slice(start, start + INSERT_CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value, index) => {
        params.push(value);
        return placeholder(table.columns.at(index) ?? '', params.length, jsonColumns);
      });
      return `(${placeholders.join(', ')})`;
    });
    const columns = table.columns.map((column) => `"${column}"`).join(', ');
    await exec(
      `insert into c15t."${table.name}" (${columns}) values ${tuples.join(', ')} on conflict ("id") do nothing`,
      params,
    );
  }
}

const SUBJECT: Table = {
  name: 'subject',
  columns: ['id', 'externalId', 'tenantId', 'createdAt', 'updatedAt'],
};
const DOMAIN: Table = {
  name: 'domain',
  columns: ['id', 'name', 'tenantId', 'createdAt', 'updatedAt'],
};
const PURPOSE: Table = {
  name: 'consentPurpose',
  columns: ['id', 'code', 'tenantId', 'createdAt', 'updatedAt'],
};
const DECISION: Table = {
  name: 'runtimePolicyDecision',
  columns: [
    'id',
    'tenantId',
    'policyId',
    'fingerprint',
    'matchedBy',
    'countryCode',
    'regionCode',
    'jurisdiction',
    'model',
    'dedupeKey',
    'createdAt',
  ],
};
const CONSENT: Table = {
  name: 'consent',
  columns: [
    'id',
    'subjectId',
    'domainId',
    'purposeIds',
    'choice',
    'userAgent',
    'givenAt',
    'jurisdiction',
    'consentAction',
    'tenantId',
  ],
};

const purposeId = (tenantId: string, code: string) => `${tenantId}-purpose-${code}`;
const domainId = (tenantId: string, name: string) => `${tenantId}-domain-${name}`;

/** The `runtimePolicyDecision` row of a fixture, or nothing when it has no country. */
function decisionRow(
  f: ConsentFixture,
  id: string,
  stamp: string,
): readonly (string | null)[] | undefined {
  if (f.countryCode === undefined) return undefined;
  return [
    `${id}-decision`,
    f.tenantId,
    'policy',
    `${id}-fp`,
    'country',
    f.countryCode,
    f.regionCode ?? null,
    f.jurisdiction ?? null,
    'opt-in',
    `${id}-dedupe`,
    stamp,
  ];
}

/** The `consent` row of a fixture. The granted codes go to `purposeIds`, the answers to `choice`. */
function consentRow(f: ConsentFixture, id: string): readonly (string | null)[] {
  const granted = [
    ...Object.entries(f.choice ?? {})
      .filter(([, value]) => value)
      .map(([code]) => code),
    ...(f.legacyPurposes ?? []),
  ];
  return [
    id,
    f.subjectId,
    domainId(f.tenantId, f.domain),
    json(granted.map((code) => purposeId(f.tenantId, code))),
    f.choice === undefined || f.choice === null ? null : receipts(f.choice),
    f.userAgent ?? null,
    f.givenAt,
    f.jurisdiction ?? null,
    'custom',
    f.tenantId,
  ];
}

async function seedConsents(exec: Exec, fixtures: readonly ConsentFixture[]): Promise<void> {
  const stamp = '2026-01-01 00:00:00';
  const unique = <T>(items: readonly (readonly [string, T])[]) => [...new Map(items).values()];

  const domains = unique(
    fixtures.map((f) => [
      domainId(f.tenantId, f.domain),
      [domainId(f.tenantId, f.domain), f.domain, f.tenantId, stamp, stamp],
    ]),
  );
  const subjects = unique(
    fixtures.map((f) => [
      f.subjectId,
      [f.subjectId, f.externalId ?? null, f.tenantId, stamp, stamp],
    ]),
  );
  const purposes = unique(
    fixtures.flatMap((f) =>
      [...Object.keys(f.choice ?? {}), ...(f.legacyPurposes ?? [])].map(
        (code) =>
          [
            purposeId(f.tenantId, code),
            [purposeId(f.tenantId, code), code, f.tenantId, stamp, stamp],
          ] as const,
      ),
    ),
  );
  const consents = fixtures.map((f, index) => {
    const id = f.id ?? `${f.tenantId}-consent-${index}`;
    return { id, decision: decisionRow(f, id, stamp), row: consentRow(f, id) };
  });

  await insertRows(exec, DOMAIN, domains);
  await insertRows(exec, SUBJECT, subjects);
  await insertRows(exec, PURPOSE, purposes);
  await insertRows(
    exec,
    DECISION,
    consents.flatMap((c) => (c.decision === undefined ? [] : [c.decision])),
  );
  await insertRows(
    exec,
    CONSENT,
    consents.map((c) => c.row),
    ['purposeIds', 'choice'],
  );
  // The decision link is set after both rows exist (c15t does the same).
  for (const c of consents) {
    if (c.decision === undefined) continue;
    await exec('update c15t."consent" set "runtimePolicyDecisionId" = $1 where "id" = $2', [
      c.decision[0],
      c.id,
    ]);
  }
}

/** Deletes this run's app rows. `admin_audit` is append-only by design and is left alone. */
async function cleanupApp(exec: Exec, prefix: string): Promise<void> {
  assertRunPrefix(prefix);
  const like = `${prefix}-%`;
  await exec(
    'delete from app.site_member where site_id in (select id from app.site where key like $1) or user_id in (select id from app."user" where email like $1)',
    [like],
  );
  await exec('delete from app.site where key like $1', [like]);
  await exec('delete from app."user" where email like $1', [like]);
}

async function cleanupC15t(exec: Exec, prefix: string): Promise<void> {
  assertRunPrefix(prefix);
  const like = `${prefix}-%`;
  for (const table of ['consent', 'runtimePolicyDecision', 'subject', 'domain', 'consentPurpose']) {
    await exec(`delete from c15t."${table}" where "tenantId" like $1`, [like]);
  }
}

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

export async function createPgliteEnvironment(): Promise<TestEnvironment> {
  const client = new PGlite();
  // What infra/postgres/init.sql sets up, then the real migrations as the app role.
  await client.exec(`
    create role dashboard;
    create role c15t_api;
    create schema app authorization dashboard;
    set role dashboard;
  `);
  await applyMigrations(pgliteExecutor(client), { migrationsFolder: MIGRATIONS });
  await client.exec('reset role');
  await client.exec(C15T_DDL);
  // The pglite driver and the postgres.js driver share the query builder, not the type.
  const primary = drizzle(client, {
    schema: { user, session, account, verification, rateLimit, site, siteMember, adminAudit },
  }) as unknown as Database;
  const exec: Exec = async (text, params) => {
    await client.query(text, params ? [...params] : []);
  };
  const prefix = newPrefix();
  return {
    kind: 'pglite',
    prefix,
    pools: {
      primary,
      analytics: primary,
      ping: async () => {
        await client.query('select 1');
      },
      close: async () => undefined,
    },
    seedConsents: (rows) => seedConsents(exec, rows),
    listen: (channel, onMessage) => client.listen(channel, onMessage),
    cleanup: async () => {
      await cleanupC15t(exec, prefix);
      await cleanupApp(exec, prefix);
    },
    close: () => client.close(),
  };
}

function requireVariable(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set, so the real-database tests cannot run. Yarn injects it from the dev env ` +
        'file (.yarnrc.yml: injectEnvironmentFiles). These tests never skip silently.',
    );
  }
  return value;
}

async function createPostgresEnvironment(): Promise<TestEnvironment> {
  const dashboardUrl = requireVariable(
    'DATABASE_URL_DASHBOARD',
    process.env['DATABASE_URL_DASHBOARD'],
  );
  const c15tUrl = requireVariable('DATABASE_URL_C15T', process.env['DATABASE_URL_C15T']);
  // Tiny pools: the shared dev database allows 100 connections in total.
  const handle = createDatabase({
    primaryUrl: dashboardUrl,
    applicationName: 'c15t-dashboard-api-test',
    primaryMax: 3,
  });
  const seedPool = createPool({
    url: c15tUrl,
    role: 'primary',
    applicationName: 'c15t-dashboard-api-test-seed',
    max: 1,
  });
  const exec: Exec = async (text, params) => {
    await seedPool.unsafe(text, params ? ([...params] as never[]) : []);
  };
  const cleanupPool = createPool({
    url: dashboardUrl,
    role: 'primary',
    applicationName: 'c15t-dashboard-api-test-cleanup',
    max: 1,
  });
  const dashboardExec: Exec = async (text, params) => {
    await cleanupPool.unsafe(text, params ? ([...params] as never[]) : []);
  };
  try {
    const tables = await seedPool.unsafe(
      `select to_regclass('app."user"') as app_user, to_regclass('c15t."consent"') as consent`,
    );
    if (tables[0]?.['app_user'] === null || tables[0]?.['consent'] === null) {
      throw new Error(
        'The app or c15t schema is not migrated. Run yarn db:migrate and yarn c15t:migrate.',
      );
    }
  } catch (error) {
    await Promise.all([
      handle.close(),
      seedPool.end({ timeout: 2 }),
      cleanupPool.end({ timeout: 2 }),
    ]);
    throw error;
  }
  const prefix = newPrefix();
  return {
    kind: 'postgres',
    prefix,
    pools: handle,
    seedConsents: (rows) => seedConsents(exec, rows),
    listen: async (channel, onMessage) => {
      // A dedicated connection to the primary, as consent-api's listener uses.
      const listener = createPool({
        url: dashboardUrl,
        role: 'primary',
        applicationName: 'c15t-dashboard-api-test-listen',
        max: 1,
      });
      const subscription = await listener.listen(channel, onMessage);
      return async () => {
        await subscription.unlisten();
        await listener.end({ timeout: 2 });
      };
    },
    cleanup: async () => {
      await cleanupC15t(exec, prefix);
      await cleanupApp(dashboardExec, prefix);
    },
    close: async () => {
      await Promise.all([
        handle.close(),
        seedPool.end({ timeout: 5 }),
        cleanupPool.end({ timeout: 5 }),
      ]);
    },
  };
}

export function createEnvironment(kind: EnvironmentKind): Promise<TestEnvironment> {
  return kind === 'pglite' ? createPgliteEnvironment() : createPostgresEnvironment();
}
