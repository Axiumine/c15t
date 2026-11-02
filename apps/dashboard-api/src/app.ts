// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Hono } from 'hono';
import { AUTH_BASE_PATH, type Auth } from './auth.js';
import { authEndpointHandler } from './auth-endpoints.js';
import { createAuthz } from './authz.js';
import type { AppDatabase } from './db.js';
import type { Env } from './env.js';
import { createErrorHandler, notFoundHandler } from './error-handler.js';
import { originGuard, requestBodyLimit, responseHeaders } from './http-guards.js';
import type { Logger } from './logger.js';
import { adminAuditRoutes } from './routes/admin-audit.js';
import { adminSiteRoutes } from './routes/admin-sites.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { siteRoutes } from './routes/sites.js';

export interface AppDeps {
  readonly env: Pick<Env, 'BETTER_AUTH_URL'>;
  readonly db: AppDatabase;
  readonly auth: Auth;
  readonly logger: Logger;
  readonly now?: () => Date;
}

/**
 * The JSON API below `/api` (docs/dashboard.md "API (dashboard-api)"), without Better Auth. Each group
 * attaches its own guard: `/admin/*` needs `requireAdmin`, `/sites/:siteKey/*` needs
 * `requireSiteAccess`, `/me` and `/sites` need a session. `/health` is the only open route.
 */
export function createApi(deps: AppDeps) {
  const authz = createAuthz({
    auth: deps.auth,
    db: deps.db,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  const now = deps.now ?? (() => new Date());
  return new Hono()
    .route('/health', healthRoutes({ db: deps.db }))
    .route('/me', meRoutes(authz))
    .route('/sites', siteRoutes({ db: deps.db, authz, now }))
    .route('/admin/sites', adminSiteRoutes({ db: deps.db, authz }))
    .route('/admin/users', adminUserRoutes({ db: deps.db, auth: deps.auth, authz, now }))
    .route('/admin/audit', adminAuditRoutes({ db: deps.db, authz }));
}

/** Type for the dashboard-web client: `hc<AppType>('/api')`. */
export type AppType = ReturnType<typeof createApi>;

export function createApp(deps: AppDeps) {
  const trustedOrigin = new URL(deps.env.BETTER_AUTH_URL).origin;
  const app = new Hono();

  app.use('*', responseHeaders);
  app.use('/api/*', originGuard(trustedOrigin));
  app.use('/api/*', requestBodyLimit);

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, authEndpointHandler(deps.auth));
  app.route('/api', createApi(deps));

  app.onError(createErrorHandler(deps.logger));
  app.notFound(notFoundHandler);
  return app;
}
