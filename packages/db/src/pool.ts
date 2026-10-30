// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import postgres from 'postgres';

export type PoolRole = 'primary' | 'replica';

export interface CreatePoolOptions {
  /** Postgres URL that uses the internal DNS name of the leader (or of the replica endpoint). */
  readonly url: string;
  /** `primary` requires a read-write session, so a stale DNS answer fails fast. */
  readonly role: PoolRole;
  /** Shows up in `pg_stat_activity`. */
  readonly applicationName: string;
  /** Pool size. Default 5, capped at 10 (CLAUDE.md: dashboard-api <= 10). */
  readonly max?: number;
  /** Connections are recycled after this many seconds, so they leave a demoted node. Default 300. */
  readonly maxLifetimeSeconds?: number;
}

export const POOL_MAX_CEILING = 10;
const DEFAULT_POOL_MAX = 5;
const DEFAULT_MAX_LIFETIME_SECONDS = 300;
const CONNECT_TIMEOUT_SECONDS = 5;
const KEEP_ALIVE_SECONDS = 30;
const IDLE_TIMEOUT_SECONDS = 30;

/**
 * postgres.js pool tuned for the Patroni rules in CLAUDE.md: `target_session_attrs` on the
 * primary, a 5 s connect timeout, TCP keepalive, a capped connection lifetime and a small `max`.
 * postgres.js has no pool-level 'error' event: a broken idle connection is dropped and replaced
 * on its own, and a failure on a live query rejects that query (see `isFailoverError`). Nothing
 * here can exit the process. Connections are opened lazily, so creating a pool does not touch
 * the network.
 */
export function createPool(options: CreatePoolOptions): postgres.Sql {
  const max = Math.min(Math.max(options.max ?? DEFAULT_POOL_MAX, 1), POOL_MAX_CEILING);
  return postgres(options.url, {
    max,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    max_lifetime: options.maxLifetimeSeconds ?? DEFAULT_MAX_LIFETIME_SECONDS,
    keep_alive: KEEP_ALIVE_SECONDS,
    target_session_attrs: options.role === 'primary' ? 'read-write' : 'prefer-standby',
    // UTC for every session: timestamptz text always carries `+00` and `now()` is deterministic,
    // whatever time zone the host or the role default has.
    connection: { application_name: options.applicationName, TimeZone: 'UTC' },
    onnotice: () => undefined,
  });
}
