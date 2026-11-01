// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import postgres from 'postgres';
import { type Latch, listenConfig, type PostgresListenerOptions } from './listener-config.js';
import { type ListenerDriver, type ListenerSession, SITE_CHANNEL } from './listener-types.js';

function sessionOf(sql: postgres.Sql, latch: Latch): ListenerSession {
  return {
    async ping() {
      const rows = await sql`select pg_is_in_recovery() as in_recovery`;
      if (rows[0]?.['in_recovery'] !== false) {
        throw new Error('The listener is connected to a standby');
      }
    },
    async close() {
      latch.closed = true;
      await sql.end({ timeout: 2 });
    },
  };
}

/**
 * One dedicated postgres.js connection that has issued `LISTEN`. It must never reconnect on its
 * own: a fresh connection has no `LISTEN`. So a close ends the session (`onClose`) and the
 * listener opens a new one. `target_session_attrs` keeps it off a standby, TCP keepalive finds a
 * dead peer, and `ping` catches a node that was demoted without dropping the connection.
 */
export function createPostgresListenerDriver(options: PostgresListenerOptions): ListenerDriver {
  const channel = options.channel ?? SITE_CHANNEL;
  return {
    async open(handlers) {
      const latch: Latch = { closed: false };
      const sql = postgres(options.url, listenConfig(options, channel, handlers, latch));
      try {
        await sql.unsafe(`listen "${channel.replace(/"/g, '""')}"`);
      } catch (error) {
        latch.closed = true;
        await sql.end({ timeout: 0 }).catch(() => undefined);
        throw error;
      }
      return sessionOf(sql, latch);
    },
  };
}
