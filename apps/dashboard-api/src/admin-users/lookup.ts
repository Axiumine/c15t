// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { site, user } from '@consent/db';
import { eq, inArray } from 'drizzle-orm';
import type { Executor, Transaction } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { countOtherActiveAdmins, isBanActive, loadUserSummaries } from '../users.js';
import type { AdminUserRouteDeps } from './context.js';

export async function findUser(executor: Executor, id: string) {
  const [row] = await executor.select().from(user).where(eq(user.id, id)).limit(1);
  if (row === undefined) throw notFound('User not found');
  return row;
}

/** Site IDs for `siteKeys`. Unknown keys are a validation error, not a silent skip. */
export async function resolveSiteIds(executor: Executor, siteKeys: readonly string[]) {
  if (siteKeys.length === 0) return [];
  const rows = await executor
    .select({ id: site.id, key: site.key })
    .from(site)
    .where(inArray(site.key, [...siteKeys]));
  const known = new Set(rows.map((row) => row.key));
  const unknown = siteKeys.filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new HttpError('VALIDATION_ERROR', 'Unknown site key', [
      { path: 'siteKeys', message: `Unknown site: ${unknown.join(', ')}` },
    ]);
  }
  return rows;
}

/** UTF-16 code-unit order, like the default `sort()` and independent of the locale. */
export const byCodeUnit = (a: string, b: string): number => Number(a > b) - Number(a < b);

/** Refuses to demote or ban the only active administrator. */
export async function ensureNotLastAdmin(
  tx: Transaction,
  target: typeof user.$inferSelect,
  now: () => Date,
) {
  if (target.role !== 'admin' || isBanActive(target, now())) return;
  if ((await countOtherActiveAdmins(tx, target.id, now())) === 0) {
    throw new HttpError('LAST_ADMIN', 'At least one active administrator must remain');
  }
}

export async function summaryOf({ db, now }: AdminUserRouteDeps, id: string) {
  const [summary] = await loadUserSummaries(db.primary, now(), [id]);
  if (summary === undefined) throw notFound('User not found');
  return summary;
}
