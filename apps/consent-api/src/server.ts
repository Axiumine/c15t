// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createPool } from '@consent/db';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { createLogger, errorFields } from './log.js';
import { listen } from './server-listen.js';
import { handleSignals } from './server-signals.js';
import { createListener, createRegistry } from './server-wiring.js';
import { createPgSiteStore } from './site-store.js';

/*
 * Wiring only. Node 26, systemd (README D7): `node dist/server.js` with the environment from
 * EnvironmentFile=. SIGTERM stops accepting, lets in-flight requests finish, then closes the
 * listener, the c15t instances and the registry pool.
 */

const log = createLogger();

function main(): void {
  const env = loadEnv();

  const sql = createPool({
    url: env.DATABASE_URL_C15T,
    role: 'primary',
    applicationName: 'consent-api',
    max: env.CONSENT_API_REGISTRY_POOL_MAX,
  });
  const store = createPgSiteStore(sql);
  const registry = createRegistry(env, store, log);
  const listener = createListener(env, registry, log);

  const app = createApp({
    registry,
    trustedProxies: env.CONSENT_API_TRUSTED_PROXIES,
    readiness: () => store.check(),
    listenerState: () => listener.state,
    logger: log,
  });

  const server = listen(app, env, log);
  listener.start();
  handleSignals({ server, listener, registry, sql }, log);
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
