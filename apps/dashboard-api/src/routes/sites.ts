// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { retryRead } from '@consent/db';
import {
  consentExportQuerySchema,
  consentListQuerySchema,
  statsQuerySchema,
} from '@consent/shared';
import { Hono } from 'hono';
import { type AuthedEnv, type Authz, accessibleSites, type SiteEnv } from '../authz.js';
import { consentBatches, consentCsvStream, consentStats, listConsents } from '../c15t-read.js';
import type { AppDatabase } from '../db.js';
import { boundsFromQuery, statsRange } from '../range.js';
import { toSite, toSiteDetail } from '../site-mapping.js';
import { validate } from '../validate.js';

export interface SiteRouteDeps {
  readonly db: Pick<AppDatabase, 'primary' | 'analytics'>;
  readonly authz: Pick<Authz, 'requireSession' | 'requireSiteAccess'>;
  readonly now: () => Date;
}

const csvFileName = (siteKey: string, now: Date) =>
  `consents-${siteKey}-${now.toISOString().slice(0, 10)}.csv`;

/**
 * Everything under `/api/sites`. The group needs a session; every `/:siteKey` route sits behind
 * `requireSiteAccess` (404 for sites the user cannot see), and its handlers only receive the
 * `TenantScope` that guard built.
 */
export function siteRoutes({ db, authz, now }: SiteRouteDeps) {
  const scoped = new Hono<SiteEnv>()
    .use('*', authz.requireSiteAccess)
    .get('/', (c) => c.json(toSiteDetail(c.get('site'))))
    // Analytics pool: heavy aggregates may run on a replica (docs/decisions.md D9).
    .get('/stats', validate('query', statsQuerySchema), async (c) => {
      const range = statsRange(c.req.valid('query'), now());
      return c.json(await retryRead(() => consentStats(db.analytics, c.get('scope'), range)));
    })
    .get('/consents', validate('query', consentListQuerySchema), async (c) => {
      const { subject, from, to, cursor, limit } = c.req.valid('query');
      const filters = { subject, ...boundsFromQuery({ from, to }) };
      return c.json(
        await retryRead(() =>
          listConsents(db.analytics, c.get('scope'), filters, { cursor, limit }),
        ),
      );
    })
    .get('/consents.csv', validate('query', consentExportQuerySchema), async (c) => {
      const scope = c.get('scope');
      const filters = boundsFromQuery(c.req.valid('query'));
      // Fetch the first batch before the response starts, so a database failure is still a
      // clean 503 and not a truncated 200. A generator that threw is finished, so a retry
      // starts a new one.
      const { batches, first } = await retryRead(async () => {
        const started = consentBatches(db.analytics, scope, filters);
        return { batches: started, first: await started.next() };
      });
      const body = consentCsvStream(batches, first);
      return c.body(body, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFileName(c.get('site').key, now())}"`,
      });
    });

  return new Hono<AuthedEnv>()
    .use('*', authz.requireSession)
    .get('/', async (c) => {
      const rows = await accessibleSites(db.primary, c.get('user'));
      return c.json({ items: rows.map(toSite) });
    })
    .route('/:siteKey', scoped);
}
