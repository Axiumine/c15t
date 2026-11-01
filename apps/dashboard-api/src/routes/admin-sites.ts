// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { site } from '@consent/db';
import { siteCreateSchema, siteKeySchema, siteUpdateSchema } from '@consent/shared';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createSite } from '../admin-sites/create.js';
import { updateSite } from '../admin-sites/update.js';
import { auditActor } from '../audit-actor.js';
import type { AuthedEnv, Authz } from '../authz.js';
import type { AppDatabase } from '../db.js';
import { toSite } from '../site-mapping.js';
import { validate } from '../validate.js';

export interface AdminSiteRouteDeps {
  readonly db: Pick<AppDatabase, 'primary' | 'transaction'>;
  readonly authz: Pick<Authz, 'requireAdmin'>;
}

const siteParamSchema = z.object({ siteKey: siteKeySchema });

/**
 * Admin site management. `NOTIFY site_changed` is sent by the trigger on `app.site` (migration
 * 0001), inside the same transaction, so consent-api only hears about committed changes. A site
 * is disabled, never deleted: its consent records are legal proof (docs/decisions.md D6).
 */
export function adminSiteRoutes({ db, authz }: AdminSiteRouteDeps) {
  return new Hono<AuthedEnv>()
    .use('*', authz.requireAdmin)
    .get('/', async (c) => {
      const rows = await db.primary.select().from(site).orderBy(asc(site.name), asc(site.key));
      return c.json({ items: rows.map(toSite) });
    })
    .post('/', validate('json', siteCreateSchema), async (c) => {
      const created = await createSite(db, auditActor(c), c.req.valid('json'));
      return c.json(toSite(created), 201);
    })
    .patch(
      '/:siteKey',
      validate('param', siteParamSchema),
      validate('json', siteUpdateSchema),
      async (c) => {
        const { siteKey } = c.req.valid('param');
        const updated = await updateSite(db, auditActor(c), siteKey, c.req.valid('json'));
        return c.json(toSite(updated));
      },
    );
}
