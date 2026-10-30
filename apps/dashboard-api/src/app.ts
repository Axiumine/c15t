// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { AUTH_BASE_PATH, type Auth } from './auth.js';
import { createAuthz } from './authz.js';
import type { AppDatabase } from './db.js';
import type { Env } from './env.js';
import { createErrorHandler, errorResponse, HttpError, notFoundHandler } from './errors.js';
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

const MAX_BODY_BYTES = 64 * 1024;

/**
 * The JSON API below `/api` (README "API (dashboard-api)"), without Better Auth. Each group
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

/**
 * The only Better Auth routes a browser may reach. The admin plugin's own HTTP endpoints stay
 * closed: they would let an admin skip the audit log and the last-admin rule. Our
 * `/api/admin/*` routes call them server-side instead.
 */
const AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  'POST /sign-in/email',
  'POST /sign-out',
  'GET /get-session',
  'POST /change-password',
]);

const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(url: string | undefined): string | undefined {
  try {
    return url === undefined ? undefined : new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function createApp(deps: AppDeps) {
  const trustedOrigin = new URL(deps.env.BETTER_AUTH_URL).origin;
  const app = new Hono();

  app.use(
    '*',
    createMiddleware(async (c, next) => {
      await next();
      // On every response, errors and 404s included (README D10).
      c.header('X-Robots-Tag', 'noindex, nofollow');
      c.header('Cache-Control', 'no-store');
      c.header('X-Content-Type-Options', 'nosniff');
    }),
  );

  // CSRF: SameSite=Lax cookies are the first line, this origin check is the second. A browser
  // always sends Origin (or Referer) on a same-origin write.
  app.use(
    '/api/*',
    createMiddleware(async (c, next) => {
      if (UNSAFE_METHODS.has(c.req.method)) {
        const origin = c.req.header('origin') ?? originOf(c.req.header('referer'));
        if (origin !== trustedOrigin) {
          throw new HttpError('FORBIDDEN', 'Cross-origin request rejected');
        }
      }
      await next();
    }),
  );
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => errorResponse(c, 'BAD_REQUEST', 'Request body too large'),
    }),
  );

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => {
    const endpoint = c.req.path.slice(AUTH_BASE_PATH.length);
    if (!AUTH_ENDPOINTS.has(`${c.req.method} ${endpoint}`)) return errorResponse(c, 'NOT_FOUND');
    return deps.auth.handler(c.req.raw);
  });
  app.route('/api', createApi(deps));

  app.onError(createErrorHandler(deps.logger));
  app.notFound(notFoundHandler);
  return app;
}
