// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { serve } from '@hono/node-server';
import { compose } from './compose.js';
import { EnvError, loadEnv } from './env.js';
import { consoleLogger as logger } from './logger.js';

const SHUTDOWN_GRACE_MS = 10_000;

let env: ReturnType<typeof loadEnv>;
try {
  env = loadEnv();
} catch (error) {
  logger.error('invalid configuration', {
    problems: error instanceof EnvError ? error.problems : ['unreadable environment'],
  });
  process.exit(1);
}

const { app, db } = compose(env, logger);
const server = serve(
  { fetch: app.fetch, hostname: env.DASHBOARD_API_HOST, port: env.DASHBOARD_API_PORT },
  (info) => logger.info('dashboard-api listening', { host: info.address, port: info.port }),
);

let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  logger.info('shutting down', { signal });
  const force = setTimeout(() => {
    logger.error('shutdown timed out');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  server.close(() => {
    db.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
// A failed query during a Patroni failover must never take the service down (docs/decisions.md D9).
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', {
    reason: reason instanceof Error ? reason.name : typeof reason,
  });
});
