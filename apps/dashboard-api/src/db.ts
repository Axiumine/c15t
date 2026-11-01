// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { AsyncLocalStorage } from 'node:async_hooks';
import { createDatabase, type Database, type DatabaseHandle } from '@consent/db';
import type { Env } from './env.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query: a pool-backed database or an open transaction. */
export type Executor = Database | Transaction;

export type DatabasePools = Pick<DatabaseHandle, 'primary' | 'analytics' | 'ping' | 'close'>;

export interface AppDatabase {
  /** Authz, `app.*` reads and every write (README D9). */
  readonly primary: Database;
  /** Read-only analytics over `c15t.*`. The primary pool when no replica is configured. */
  readonly analytics: Database;
  /**
   * The database handed to Better Auth. Inside `transaction()` it resolves to the open
   * transaction, so a `auth.api.*` call and the audit row commit or roll back together.
   */
  readonly authDb: Database;
  /** Runs `run` in one primary transaction. Writes are never retried. */
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Pool budget: dashboard-api stays within 10 connections in total (CLAUDE.md "PostgreSQL").
 * With a replica the primary gets 6 and the replica 4, otherwise the primary pool serves both.
 */
const PRIMARY_MAX_WITH_REPLICA = 6;
const PRIMARY_MAX_ALONE = 8;
const REPLICA_MAX = 4;

export function openDatabase(
  env: Pick<Env, 'DATABASE_URL_DASHBOARD' | 'DATABASE_URL_DASHBOARD_REPLICA'>,
  applicationName = 'c15t-dashboard-api',
): AppDatabase {
  const replicaUrl = env.DATABASE_URL_DASHBOARD_REPLICA;
  return wrapDatabase(
    createDatabase({
      primaryUrl: env.DATABASE_URL_DASHBOARD,
      replicaUrl,
      applicationName,
      primaryMax: replicaUrl === undefined ? PRIMARY_MAX_ALONE : PRIMARY_MAX_WITH_REPLICA,
      replicaMax: REPLICA_MAX,
    }),
  );
}

export function wrapDatabase(pools: DatabasePools): AppDatabase {
  const openTransaction = new AsyncLocalStorage<Transaction>();

  const authDb = new Proxy(pools.primary, {
    get(target, property) {
      const current: Database | Transaction = openTransaction.getStore() ?? target;
      const value: unknown = Reflect.get(current, property, current);
      if (typeof value !== 'function') return value;
      const bound: unknown = value.bind(current);
      return bound;
    },
  });

  return {
    primary: pools.primary,
    analytics: pools.analytics,
    authDb,
    transaction: (run) => pools.primary.transaction((tx) => openTransaction.run(tx, () => run(tx))),
    ping: pools.ping,
    close: pools.close,
  };
}
