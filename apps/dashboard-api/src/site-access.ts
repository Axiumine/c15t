// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type SiteRow, site, siteMember } from '@consent/db';
import { siteKeySchema } from '@consent/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { type SessionUser, type SiteEnv, tenantScope } from './authz-types.js';
import type { AppDatabase, Executor } from './db.js';
import { notFound } from './errors.js';
import type { SessionSlot } from './session.js';

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

type LoadUser = (c: SessionSlot, allowPasswordChange: boolean) => Promise<SessionUser>;

/**
 * Resolves `:siteKey` against the sites the user can access. A missing, disabled (for users)
 * or unassigned site is the same 404, so site keys cannot be enumerated.
 */
export function createSiteAccessGuard(
  load: LoadUser,
  db: Pick<AppDatabase, 'primary'>,
): MiddlewareHandler<SiteEnv> {
  return createMiddleware<SiteEnv>(async (c, next) => {
    const user = await load(c, false);
    const key = siteKeySchema.safeParse(c.req.param('siteKey'));
    const match = key.success
      ? (await accessibleSites(db.primary, user)).find((row) => row.key === key.data)
      : undefined;
    if (match === undefined) throw notFound('Site not found');
    c.set('site', match);
    c.set('scope', tenantScope([match.key]));
    await next();
  });
}
