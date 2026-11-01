// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Env } from './env.js';
import { createSiteInstance } from './instance.js';
import { SiteChangeListener } from './listener.js';
import { createPostgresListenerDriver } from './listener-driver.js';
import type { Logger } from './log.js';
import { SiteRegistry } from './registry.js';
import type { SiteStore } from './site-store.js';

const DB_MAX_LIFETIME_SECONDS = 300;

export function createRegistry(env: Env, store: SiteStore, log: Logger): SiteRegistry {
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

export function createListener(env: Env, registry: SiteRegistry, log: Logger): SiteChangeListener {
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
