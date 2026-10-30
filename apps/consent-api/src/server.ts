// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createPool } from '@consent/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { createSiteInstance } from './instance.js';
import { createPostgresListenerDriver, SiteChangeListener } from './listener.js';
import { createLogger, errorFields } from './log.js';
import { SiteRegistry } from './registry.js';
import { createPgSiteStore } from './site-store.js';

/*
 * Wiring only. Node 26, systemd (README D7): `node dist/server.js` with the environment from
 * EnvironmentFile=. SIGTERM stops accepting, lets in-flight requests finish, then closes the
 * listener, the c15t instances and the registry pool.
 */

const DB_MAX_LIFETIME_SECONDS = 300;
// nginx keeps upstream connections for 60 s by default: close idle ones after that, not before.
const KEEP_ALIVE_TIMEOUT_MS = 75_000;
const HEADERS_TIMEOUT_MS = 80_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_MS = 10_000;

const log = createLogger();

async function main(): Promise<void> {
  const env = loadEnv();

  const sql = createPool({
    url: env.DATABASE_URL_C15T,
    role: 'primary',
    applicationName: 'consent-api',
    max: env.CONSENT_API_REGISTRY_POOL_MAX,
  });
  const store = createPgSiteStore(sql);

  const registry = new SiteRegistry({
    store,
    logger: log,
    factory: (site) =>
      createSiteInstance(site, {
        apiKey: env.C15T_ADMIN_API_KEY,
        database: {
          url: env.DATABASE_URL_C15T,
          poolMax: env.CONSENT_API_INSTANCE_POOL_MAX,
          prepare: env.CONSENT_API_DB_PREPARE,
          maxLifetimeSeconds: DB_MAX_LIFETIME_SECONDS,
        },
      }),
  });

  const listener = new SiteChangeListener({
    driver: createPostgresListenerDriver({ url: env.DATABASE_URL_C15T }),
    onChange: (siteKey) => {
      log.info('site changed', { siteKey });
      registry.invalidate(siteKey);
    },
    onResync: () => registry.invalidateAll(),
    logger: log,
  });

  const app = createApp({
    registry,
    trustedProxies: env.CONSENT_API_TRUSTED_PROXIES,
    readiness: () => store.check(),
    listenerState: () => listener.state,
    logger: log,
  });

  const server = serve(
    { fetch: app.fetch, hostname: env.CONSENT_API_HOST, port: env.CONSENT_API_PORT },
    (info) => {
      log.info('consent-api listening', { host: info.address, port: info.port });
    },
  );
  if ('keepAliveTimeout' in server) {
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
  }
  listener.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
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
  };

  const stop = (reason: string): void => {
    shutdown(reason).catch((error: unknown) => {
      log.error('shutdown failed', errorFields(error));
      process.exitCode = 1;
    });
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop(signal));
  // Most often EADDRINUSE: release the pools and exit non-zero so systemd retries.
  server.on('error', (error) => {
    log.error('server error', errorFields(error));
    process.exitCode = 1;
    stop('server error');
  });
}

// A rejected promise in a driver must not take the service down mid-failover: log it and let the
// pool recover (CLAUDE.md "PostgreSQL").
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', errorFields(reason));
});

main().catch((error: unknown) => {
  log.error('startup failed', errorFields(error));
  process.exitCode = 1;
});
