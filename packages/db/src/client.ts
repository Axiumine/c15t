// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { createPool } from './pool.js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  /** `DATABASE_URL_DASHBOARD`: the primary, by internal DNS name. */
  readonly primaryUrl: string;
  /** `DATABASE_URL_DASHBOARD_REPLICA`, optional. Without it `analytics` reuses the primary pool. */
  readonly replicaUrl?: string | undefined;
  readonly applicationName: string;
  readonly primaryMax?: number;
  readonly replicaMax?: number;
}

export interface DatabaseHandle {
  /** Authz, `app.*` reads and every write. */
  readonly primary: Database;
  /** Read-only analytics over `c15t.*` (stats, search, export). Same object as `primary` when no replica is set. */
  readonly analytics: Database;
  readonly hasReplica: boolean;
  /** Cheap liveness check against the primary, for `/api/health`. */
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export function drizzleOver(sql: postgres.Sql): Database {
  return drizzle(sql, { schema });
}

/** Builds the two pools of docs/decisions.md D9. Pick the pool explicitly on every query. */
export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const primarySql = createPool({
    url: options.primaryUrl,
    role: 'primary',
    applicationName: options.applicationName,
    ...(options.primaryMax === undefined ? {} : { max: options.primaryMax }),
  });
  const replicaSql =
    options.replicaUrl === undefined || options.replicaUrl === ''
      ? undefined
      : createPool({
          url: options.replicaUrl,
          role: 'replica',
          applicationName: `${options.applicationName}-analytics`,
          ...(options.replicaMax === undefined ? {} : { max: options.replicaMax }),
        });
  const primary = drizzleOver(primarySql);
  return {
    primary,
    analytics: replicaSql === undefined ? primary : drizzleOver(replicaSql),
    hasReplica: replicaSql !== undefined,
    ping: async () => {
      await primarySql`select 1`;
    },
    close: async () => {
      await Promise.all([primarySql.end({ timeout: 5 }), replicaSql?.end({ timeout: 5 })]);
    },
  };
}
