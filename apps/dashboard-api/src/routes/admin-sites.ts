// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isUniqueViolation, type SiteRow, site } from '@consent/db';
import {
  type AuditAction,
  type SiteCreate,
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
import type { AppDatabase, Transaction } from '../db.js';
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
  const entries = UPDATABLE_FIELDS.flatMap((field): [string, Change][] => {
    // eslint-disable-next-line security/detect-object-injection -- field is a member of the closed UPDATABLE_FIELDS tuple
    const [next, previous] = [input[field], current[field]];
    if (next === undefined || JSON.stringify(next) === JSON.stringify(previous)) return [];
    return [[field, { from: previous, to: next }]];
  });
  return Object.fromEntries(entries);
}

interface RecordUpdateOptions {
  readonly actor: AuditActor;
  readonly before: SiteRow;
  readonly after: SiteRow;
  readonly changes: Record<string, Change>;
}

/** One audit row for the field changes and one for a status change (enable or disable). */
async function recordUpdate(
  tx: Transaction,
  { actor, before, after, changes }: RecordUpdateOptions,
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

/** Inserts the site and its audit row. A taken key is a 409, not a database error. */
async function createSite(
  db: AdminSiteRouteDeps['db'],
  actor: AuditActor,
  input: SiteCreate,
): Promise<SiteRow> {
  try {
    return await db.transaction(async (tx) => {
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
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError('SITE_KEY_TAKEN', 'A site with this key already exists');
    }
    throw error;
  }
}

/** Applies the changed fields under a row lock. Nothing changed means no write and no audit row. */
function updateSite(
  db: AdminSiteRouteDeps['db'],
  actor: AuditActor,
  siteKey: string,
  input: SiteUpdate,
): Promise<SiteRow> {
  return db.transaction(async (tx) => {
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
    await recordUpdate(tx, { actor, before: current, after: row, changes });
    return row;
  });
}

/**
 * Admin site management. `NOTIFY site_changed` is sent by the trigger on `app.site` (migration
 * 0001), inside the same transaction, so consent-api only hears about committed changes. A site
 * is disabled, never deleted: its consent records are legal proof (README D6).
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
