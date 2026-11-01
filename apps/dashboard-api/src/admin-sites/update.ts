// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type SiteRow, site } from '@consent/db';
import type { AuditAction, SiteUpdate } from '@consent/shared';
import { eq } from 'drizzle-orm';
import { type AuditActor, type Change, writeAudit } from '../audit.js';
import type { AppDatabase, Transaction } from '../db.js';
import { notFound } from '../errors.js';

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

/** Applies the changed fields under a row lock. Nothing changed means no write and no audit row. */
export function updateSite(
  db: Pick<AppDatabase, 'transaction'>,
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
