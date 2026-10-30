// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type SiteRow, site, siteMember } from '@consent/db';
import { ROLES, type Role, siteKeySchema } from '@consent/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Auth } from './auth.js';
import type { AppDatabase, Executor } from './db.js';
import { HttpError, notFound } from './errors.js';

/*
 * ALL access checks live here (CLAUDE.md "Authorization"). dashboard-api is the security
 * boundary: dashboard-web guards are UX only. Every route group attaches one of the guards
 * below explicitly, and a route coverage test fails for any route that answers without a session.
 */

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly mustChangePassword: boolean;
}

declare const tenantScopeBrand: unique symbol;

/**
 * The c15t `tenantId` values a request may read. Every query against `c15t.*` takes one, and
 * only the functions in this module create it: from the guards below, never from request input.
 */
export interface TenantScope {
  readonly [tenantScopeBrand]: true;
  readonly tenantIds: readonly string[];
}

export function tenantScope(siteKeys: readonly string[]): TenantScope {
  return { tenantIds: [...siteKeys] } as unknown as TenantScope;
}

export type AuthedEnv = { Variables: { user: SessionUser } };
export type SiteEnv = { Variables: { user: SessionUser; site: SiteRow; scope: TenantScope } };

/**
 * Sites the user may see. Admins see every site, including disabled ones. Users see only the
 * active sites an admin assigned to them, read from the primary so a revoked membership takes
 * effect at once (README D9).
 */
export async function accessibleSites(executor: Executor, user: SessionUser): Promise<SiteRow[]> {
  if (user.role === 'admin') {
    return executor.select().from(site).orderBy(asc(site.name), asc(site.key));
  }
  const rows = await executor
    .select({ site })
    .from(siteMember)
    .innerJoin(site, eq(site.id, siteMember.siteId))
    .where(and(eq(siteMember.userId, user.id), eq(site.status, 'active')))
    .orderBy(asc(site.name), asc(site.key));
  return rows.map((row) => row.site);
}

export async function accessibleSiteKeys(executor: Executor, user: SessionUser): Promise<string[]> {
  return (await accessibleSites(executor, user)).map((row) => row.key);
}

export interface AuthzDeps {
  readonly auth: Auth;
  readonly db: Pick<AppDatabase, 'primary'>;
  readonly now?: () => Date;
}

const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);

export function createAuthz({ auth, db, now = () => new Date() }: AuthzDeps) {
  async function loadUser(c: Context, allowPasswordChange: boolean): Promise<SessionUser> {
    const cached: SessionUser | undefined = c.get('user');
    const user = cached ?? (await readSession(c));
    if (user.mustChangePassword && !allowPasswordChange) {
      throw new HttpError(
        'PASSWORD_CHANGE_REQUIRED',
        'You must change your password before continuing',
      );
    }
    c.set('user', user);
    return user;
  }

  async function readSession(c: Context): Promise<SessionUser> {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (result === null) throw new HttpError('UNAUTHORIZED', 'Authentication is required');
    const { user } = result;
    const banActive =
      user.banned === true && (user.banExpires == null || new Date(user.banExpires) > now());
    if (banActive) throw new HttpError('UNAUTHORIZED', 'This account is disabled');
    // Fail closed: an unknown role string gets no access at all.
    if (!isRole(user.role)) throw new HttpError('FORBIDDEN', 'You are not allowed to do this');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword === true,
    };
  }

  /** Valid session, and the password has been changed if an admin required it. */
  const requireSession: MiddlewareHandler<AuthedEnv> = createMiddleware<AuthedEnv>(
    async (c, next) => {
      await loadUser(c, false);
      await next();
    },
  );

  /** Only for `/api/me`: the UI needs it to know that a password change is pending. */
  const requireSessionAllowingPasswordChange: MiddlewareHandler<AuthedEnv> =
    createMiddleware<AuthedEnv>(async (c, next) => {
      await loadUser(c, true);
      await next();
    });

  const requireAdmin: MiddlewareHandler<AuthedEnv> = createMiddleware<AuthedEnv>(
    async (c, next) => {
      const user = await loadUser(c, false);
      if (user.role !== 'admin') {
        throw new HttpError('FORBIDDEN', 'Administrator access is required');
      }
      await next();
    },
  );

  /**
   * Resolves `:siteKey` against the sites the user can access. A missing, disabled (for users)
   * or unassigned site is the same 404, so site keys cannot be enumerated.
   */
  const requireSiteAccess: MiddlewareHandler<SiteEnv> = createMiddleware<SiteEnv>(
    async (c, next) => {
      const user = await loadUser(c, false);
      const key = siteKeySchema.safeParse(c.req.param('siteKey'));
      const match = key.success
        ? (await accessibleSites(db.primary, user)).find((row) => row.key === key.data)
        : undefined;
      if (match === undefined) throw notFound('Site not found');
      c.set('site', match);
      c.set('scope', tenantScope([match.key]));
      await next();
    },
  );

  return {
    requireSession,
    requireSessionAllowingPasswordChange,
    requireAdmin,
    requireSiteAccess,
  };
}

export type Authz = ReturnType<typeof createAuthz>;
