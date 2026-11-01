// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { readMigrationFiles } from 'drizzle-orm/migrator';
import type postgres from 'postgres';

/*
 * Drizzle's stock migrator runs `CREATE SCHEMA IF NOT EXISTS` first. PostgreSQL checks the
 * CREATE privilege on the database before it checks whether the schema exists, so that fails
 * for the `dashboard` role (it owns `app` but cannot create schemas). This applies the same
 * journal and the same `__drizzle_migrations` table without that statement. The schema is
 * created once by infra/postgres/init.sql.
 */

export type SqlParam = string | number | null;

export interface SqlExecutor {
  query(text: string, params?: readonly SqlParam[]): Promise<readonly Record<string, unknown>[]>;
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface ApplyMigrationsOptions {
  readonly migrationsFolder: string;
  /** Schema of the journal table. Default `app`. */
  readonly schema?: string;
  /** Journal table. Default `__drizzle_migrations`. */
  readonly table?: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const MIGRATION_LOCK = "hashtext('c15t-platform:app-migrations')";

function identifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Invalid SQL identifier "${value}"`);
  return `"${value}"`;
}

/** Applies pending migrations in one transaction. Returns how many ran. */
export async function applyMigrations(
  executor: SqlExecutor,
  options: ApplyMigrationsOptions,
): Promise<{ applied: number }> {
  const journal = `${identifier(options.schema ?? 'app')}.${identifier(options.table ?? '__drizzle_migrations')}`;
  const migrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder });
  return executor.transaction(async (tx) => {
    // Two deploys racing each other must not apply the same migration twice.
    await tx.query(`select pg_advisory_xact_lock(${MIGRATION_LOCK})`);
    await tx.query(
      `create table if not exists ${journal} (id serial primary key, hash text not null, created_at bigint)`,
    );
    const [last] = await tx.query(
      `select created_at from ${journal} order by created_at desc limit 1`,
    );
    const lastAppliedAt = last === undefined ? null : Number(last['created_at']);
    let applied = 0;
    for (const migration of migrations) {
      if (lastAppliedAt !== null && lastAppliedAt >= migration.folderMillis) continue;
      for (const statement of migration.sql) await tx.query(statement);
      await tx.query(`insert into ${journal} ("hash", "created_at") values ($1, $2)`, [
        migration.hash,
        migration.folderMillis,
      ]);
      applied++;
    }
    return { applied };
  });
}

/** Adapter for a postgres.js pool. */
export function postgresExecutor(sql: postgres.Sql): SqlExecutor {
  const wrap = (runner: postgres.Sql | postgres.TransactionSql): SqlExecutor => ({
    query: async (text, params = []) =>
      (await runner.unsafe(text, [...params])) as Record<string, unknown>[],
    transaction: async <T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T> => {
      // `begin` exists on the pool only; inside a transaction the same connection is reused.
      if (!('begin' in runner)) return run(wrap(runner));
      // postgres.js types the result of `begin` as a conditional type that a generic `T` cannot
      // satisfy, so the value leaves the callback through a promise instead of being cast.
      const outcome = Promise.withResolvers<T>();
      await runner.begin(async (tx) => outcome.resolve(await run(wrap(tx))));
      return outcome.promise;
    },
  });
  return wrap(sql);
}
