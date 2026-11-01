// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as net from 'node:net';
import type { C15TOptions } from '@c15t/backend';
import { PgClient } from '@effect/sql-pg';
import { Duration, Redacted } from 'effect';

export type DatabaseOption = C15TOptions['database'];

export interface InstanceDatabaseConfig {
  /** `DATABASE_URL_C15T`: role `c15t_api` on the primary. */
  readonly url: string;
  /** Connections per instance. */
  readonly poolMax: number;
  /** Set `false` behind PgBouncer in transaction mode. */
  readonly prepare: boolean;
  /** Connections older than this are replaced, so they leave a demoted node (README D9). */
  readonly maxLifetimeSeconds: number;
}

const CONNECT_TIMEOUT_SECONDS = 5;
const IDLE_TIMEOUT_SECONDS = 30;
const KEEP_ALIVE_DELAY_MS = 30_000;
const SCHEMA = 'c15t';

/**
 * The c15t pool for one site, in place of `database: { dialect, url }` because that form has no
 * pool size, lifetime or keepalive. It repeats what that form adds: the `c15t` search path and a
 * UTC session (c15t stores UTC wall clocks and relies on it).
 *
 * @effect/sql-pg 4.0.0 has no `target_session_attrs`, so a connection on a demoted node is only
 * caught by `connectionTTL` and by the registry dropping the instance after a database error. It
 * has no keepalive either: the `stream` factory below supplies one. Node resolves the host on
 * every connect, so a repointed Patroni DNS name is picked up by the next connection.
 */
export function createDatabaseLayer(config: InstanceDatabaseConfig): DatabaseOption {
  const url = new URL(config.url);
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = url.port === '' ? 5432 : Number(url.port);
  // A `?host=` parameter points at a unix socket directory, which the stream below cannot dial.
  const useStream = hostname !== '' && !url.searchParams.has('host');
  return PgClient.layer({
    url: Redacted.make(config.url),
    applicationName: 'consent-api',
    maxConnections: config.poolMax,
    minConnections: 0,
    idleTimeout: Duration.seconds(IDLE_TIMEOUT_SECONDS),
    connectionTTL: Duration.seconds(config.maxLifetimeSeconds),
    connectTimeout: Duration.seconds(CONNECT_TIMEOUT_SECONDS),
    startupParameters: { search_path: SCHEMA, timezone: 'UTC' },
    prepare: config.prepare,
    ...(useStream
      ? {
          stream: () =>
            net.connect({
              host: hostname,
              port,
              noDelay: true,
              keepAlive: true,
              keepAliveInitialDelay: KEEP_ALIVE_DELAY_MS,
            }),
        }
      : {}),
  });
}
