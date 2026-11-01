// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createPool } from '@consent/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { type Env, loadEnv } from './env.js';
import { createSiteInstance } from './instance.js';
import { createPostgresListenerDriver, SiteChangeListener } from './listener.js';
import { createLogger, errorFields } from './log.js';
import { SiteRegistry } from './registry.js';
import { createPgSiteStore, type SiteStore } from './site-store.js';

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

type Server = ReturnType<typeof serve>;

function createRegistry(env: Env, store: SiteStore): SiteRegistry {
  return new SiteRegistry({
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
}

function createListener(env: Env, registry: SiteRegistry): SiteChangeListener {
  return new SiteChangeListener({
    driver: createPostgresListenerDriver({ url: env.DATABASE_URL_C15T }),
    onChange: (siteKey) => {
      log.info('site changed', { siteKey });
      registry.invalidate(siteKey);
    },
    onResync: () => registry.invalidateAll(),
    logger: log,
  });
}

function listen(app: ReturnType<typeof createApp>, env: Env): Server {
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
  return server;
}

interface Resources {
  readonly server: Server;
  readonly listener: SiteChangeListener;
  readonly registry: SiteRegistry;
  readonly sql: ReturnType<typeof createPool>;
}

/** Stops accepting, lets in-flight requests finish, then closes what the service opened. */
async function shutdown({ server, listener, registry, sql }: Resources): Promise<void> {
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

function handleSignals(resources: Resources): void {
  let shuttingDown = false;
  const stop = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal: reason });
    shutdown(resources).catch((error: unknown) => {
      log.error('shutdown failed', errorFields(error));
      process.exitCode = 1;
    });
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop(signal));
  // Most often EADDRINUSE: release the pools and exit non-zero so systemd retries.
  resources.server.on('error', (error) => {
    log.error('server error', errorFields(error));
    process.exitCode = 1;
    stop('server error');
  });
}

function main(): void {
  const env = loadEnv();

  const sql = createPool({
    url: env.DATABASE_URL_C15T,
    role: 'primary',
    applicationName: 'consent-api',
    max: env.CONSENT_API_REGISTRY_POOL_MAX,
  });
  const store = createPgSiteStore(sql);
  const registry = createRegistry(env, store);
  const listener = createListener(env, registry);

  const app = createApp({
    registry,
    trustedProxies: env.CONSENT_API_TRUSTED_PROXIES,
    readiness: () => store.check(),
    listenerState: () => listener.state,
    logger: log,
  });

  const server = listen(app, env);
  listener.start();
  handleSignals({ server, listener, registry, sql });
}

// A rejected promise in a driver must not take the service down mid-failover: log it and let the
// pool recover (CLAUDE.md "PostgreSQL").
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', errorFields(reason));
});

try {
  main();
} catch (error) {
  log.error('startup failed', errorFields(error));
  process.exitCode = 1;
}
