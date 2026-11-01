// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { createPool } from '@consent/db';
import type { SiteChangeListener } from './listener.js';
import type { Logger } from './log.js';
import type { SiteRegistry } from './registry.js';
import type { Server } from './server-listen.js';

const SHUTDOWN_GRACE_MS = 10_000;

export interface Resources {
  readonly server: Server;
  readonly listener: SiteChangeListener;
  readonly registry: SiteRegistry;
  readonly sql: ReturnType<typeof createPool>;
}

/** Stops accepting, lets in-flight requests finish, then closes what the service opened. */
export async function shutdown(
  { server, listener, registry, sql }: Resources,
  log: Logger,
): Promise<void> {
  const force = setTimeout(() => {
    log.error('shutdown timed out');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS * 2);
  force.unref();

  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  const grace = setTimeout(() => {
    if ('closeAllConnections' in server) server.closeAllConnections();
  }, SHUTDOWN_GRACE_MS);
  grace.unref();
  await closed;
  clearTimeout(grace);

  await listener.stop();
  await registry.close();
  await sql.end({ timeout: 5 });
  log.info('shutdown complete');
}
