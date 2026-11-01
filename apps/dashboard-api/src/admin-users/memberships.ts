// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { site, siteMember } from '@consent/db';
import { and, eq, notInArray } from 'drizzle-orm';
import { writeAudit } from '../audit.js';
import type { Transaction } from '../db.js';
import { lockUserAdministration } from '../users.js';
import type { AdminCall, AdminUserRouteDeps } from './context.js';
import { byCodeUnit, findUser, resolveSiteIds, summaryOf } from './lookup.js';

/** Deletes every membership of the user except the sites in `keepIds` (none kept: all). */
function removeMembershipsOutside(tx: Transaction, userId: string, keepIds: readonly string[]) {
  const outside = keepIds.length === 0 ? undefined : notInArray(siteMember.siteId, [...keepIds]);
  return tx.delete(siteMember).where(and(eq(siteMember.userId, userId), outside));
}

/** Adds the user to `sites`. An empty list writes nothing. */
export async function addMemberships(
  tx: Transaction,
  userId: string,
  sites: readonly { readonly id: string }[],
) {
  if (sites.length > 0) {
    await tx.insert(siteMember).values(sites.map((row) => ({ userId, siteId: row.id })));
  }
}

/** Replaces the user's site memberships. A request that changes nothing writes nothing. */
export async function replaceMemberships(
  deps: AdminUserRouteDeps,
  { actor }: AdminCall,
  id: string,
  siteKeys: readonly string[],
) {
  await deps.db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    await findUser(tx, id);
    const wanted = await resolveSiteIds(tx, siteKeys);
    const wantedIds = wanted.map((row) => row.id);
    const before = await tx
      .select({ siteId: siteMember.siteId, key: site.key })
      .from(siteMember)
      .innerJoin(site, eq(site.id, siteMember.siteId))
      .where(eq(siteMember.userId, id));
    const beforeIds = new Set(before.map((row) => row.siteId));
    const toAdd = wanted.filter((row) => !beforeIds.has(row.id));
    const toRemove = before.filter((row) => !wantedIds.includes(row.siteId));
    if (toAdd.length === 0 && toRemove.length === 0) return;

    if (toRemove.length > 0) await removeMembershipsOutside(tx, id, wantedIds);
    await addMemberships(tx, id, toAdd);
    await writeAudit(tx, actor, {
      action: 'user.set-sites',
      targetType: 'user',
      targetId: id,
      metadata: {
        before: before.map((row) => row.key).sort(byCodeUnit),
        after: wanted.map((row) => row.key).sort(byCodeUnit),
      },
    });
  });
  return summaryOf(deps, id);
}
