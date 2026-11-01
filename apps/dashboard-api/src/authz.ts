// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Auth } from './auth.js';
import type { AuthedEnv } from './authz-types.js';
import type { AppDatabase } from './db.js';
import { HttpError } from './errors.js';
import { loadUser, type SessionSlot } from './session.js';
import { createSiteAccessGuard } from './site-access.js';

export { type AuthedEnv, type SessionUser, type SiteEnv, tenantScope } from './authz-types.js';
export { accessibleSiteKeys, accessibleSites } from './site-access.js';

/*
 * ALL access checks live here (CLAUDE.md "Authorization"). dashboard-api is the security
 * boundary: dashboard-web guards are UX only. Every route group attaches one of the guards
 * below explicitly, and a route coverage test fails for any route that answers without a session.
 * The session, tenant scope and site lookup helpers they call are in authz-types.ts, session.ts
 * and site-access.ts.
 */

export interface AuthzDeps {
  readonly auth: Auth;
  readonly db: Pick<AppDatabase, 'primary'>;
  readonly now?: () => Date;
}

export function createAuthz({ auth, db, now = () => new Date() }: AuthzDeps) {
  const load = (c: SessionSlot, allowPasswordChange: boolean) =>
    loadUser({ auth, now }, c, allowPasswordChange);

  /** Valid session, and the password has been changed if an admin required it. */
  const requireSession: MiddlewareHandler<AuthedEnv> = createMiddleware<AuthedEnv>(
    async (c, next) => {
      await load(c, false);
      await next();
    },
  );

  /** Only for `/api/me`: the UI needs it to know that a password change is pending. */
  const requireSessionAllowingPasswordChange: MiddlewareHandler<AuthedEnv> =
    createMiddleware<AuthedEnv>(async (c, next) => {
      await load(c, true);
      await next();
    });

  const requireAdmin: MiddlewareHandler<AuthedEnv> = createMiddleware<AuthedEnv>(
    async (c, next) => {
      const user = await load(c, false);
      if (user.role !== 'admin') {
        throw new HttpError('FORBIDDEN', 'Administrator access is required');
      }
      await next();
    },
  );

  return {
    requireSession,
    requireSessionAllowingPasswordChange,
    requireAdmin,
    requireSiteAccess: createSiteAccessGuard(load, db),
  };
}

export type Authz = ReturnType<typeof createAuthz>;
