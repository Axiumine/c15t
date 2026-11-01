// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isUniqueViolation, type SiteRow, site } from '@consent/db';
import type { SiteCreate } from '@consent/shared';
import { type AuditActor, writeAudit } from '../audit.js';
import type { AppDatabase } from '../db.js';
import { HttpError } from '../errors.js';

/** Inserts the site and its audit row. A taken key is a 409, not a database error. */
export async function createSite(
  db: Pick<AppDatabase, 'transaction'>,
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
