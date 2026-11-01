// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isUniqueViolation, type SiteRow, site } from '@consent/db';
import {
  type AuditAction,
  type SiteUpdate,
  siteCreateSchema,
  siteKeySchema,
  siteUpdateSchema,
} from '@consent/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuditActor, auditActor, writeAudit } from '../audit.js';
import type { AuthedEnv, Authz } from '../authz.js';
import type { AppDatabase } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { toSite } from '../site-mapping.js';
import { validate } from '../validate.js';

export interface AdminSiteRouteDeps {
  readonly db: Pick<AppDatabase, 'primary' | 'transaction'>;
  readonly authz: Pick<Authz, 'requireAdmin'>;
}

const siteParamSchema = z.object({ siteKey: siteKeySchema });

type Change = { from: unknown; to: unknown };

const UPDATABLE_FIELDS = ['name', 'domains', 'policyPreset', 'status'] as const;

/** Fields the request would actually change. Equal values are not changes. */
function diffSite(current: SiteRow, input: SiteUpdate): Record<string, Change> {
  const changes: Record<string, Change> = {};
  for (const field of UPDATABLE_FIELDS) {
    const next = input[field];
    if (next !== undefined && JSON.stringify(next) !== JSON.stringify(current[field])) {
      changes[field] = { from: current[field], to: next };
    }
  }
  return changes;
}

/**
 * Admin site management. `NOTIFY site_changed` is sent by the trigger on `app.site` (migration
 * 0001), inside the same transaction, so consent-api only hears about committed changes. A site
 * is disabled, never deleted: its consent records are legal proof (README D6).
 */
export function adminSiteRoutes({ db, authz }: AdminSiteRouteDeps) {
  async function recordUpdate(
    tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0],
    actor: AuditActor,
    before: SiteRow,
    after: SiteRow,
    changes: Record<string, Change>,
  ) {
    const { status, ...fieldChanges } = changes;
    const entries: { action: AuditAction; metadata: Record<string, unknown> }[] = [];
    if (Object.keys(fieldChanges).length > 0) {
      entries.push({ action: 'site.update', metadata: { changes: fieldChanges } });
    }
    if (status !== undefined) {
      const action = after.status === 'disabled' ? 'site.disable' : 'site.enable';
      entries.push({ action, metadata: { changes: { status } } });
    }
    for (const entry of entries) {
      await writeAudit(tx, actor, { ...entry, targetType: 'site', targetId: before.key });
    }
  }

  return new Hono<AuthedEnv>()
    .use('*', authz.requireAdmin)
    .get('/', async (c) => {
      const rows = await db.primary.select().from(site).orderBy(asc(site.name), asc(site.key));
      return c.json({ items: rows.map(toSite) });
    })
    .post('/', validate('json', siteCreateSchema), async (c) => {
      const input = c.req.valid('json');
      const actor = auditActor(c);
      try {
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(site)
            .values({
              key: input.key,
              name: input.name,
              domains: input.domains,
              policyPreset: input.policyPreset,
            })
            .returning();
          if (row === undefined) throw new Error('insert returned no row');
          await writeAudit(tx, actor, {
            action: 'site.create',
            targetType: 'site',
            targetId: row.key,
            metadata: { name: row.name, domains: row.domains, policyPreset: row.policyPreset },
          });
          return row;
        });
        return c.json(toSite(created), 201);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError('SITE_KEY_TAKEN', 'A site with this key already exists');
        }
        throw error;
      }
    })
    .patch(
      '/:siteKey',
      validate('param', siteParamSchema),
      validate('json', siteUpdateSchema),
      async (c) => {
        const { siteKey } = c.req.valid('param');
        const input = c.req.valid('json');
        const actor = auditActor(c);
        const updated = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(site).where(eq(site.key, siteKey)).for('update');
          if (current === undefined) throw notFound('Site not found');

          const changes = diffSite(current, input);
          // Nothing changed: no write, so the trigger sends no NOTIFY and no audit row appears.
          if (Object.keys(changes).length === 0) return current;

          const [row] = await tx
            .update(site)
            // Drizzle skips undefined fields.
            .set(input)
            .where(eq(site.id, current.id))
            .returning();
          if (row === undefined) throw new Error('update returned no row');
          await recordUpdate(tx, actor, current, row, changes);
          return row;
        });
        return c.json(toSite(updated));
      },
    );
}
