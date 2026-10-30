// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { site, siteMember, type UserRow, user } from '@consent/db';
import { roleSchema, type UserSummary } from '@consent/shared';
import { and, asc, count, eq, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Executor } from './db.js';

/** A ban without an expiry, or with one in the future. */
export function isBanActive(row: Pick<UserRow, 'banned' | 'banExpires'>, now: Date): boolean {
  return row.banned && (row.banExpires === null || row.banExpires > now);
}

export function toUserSummary(row: UserRow, siteKeys: readonly string[], now: Date): UserSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: roleSchema.parse(row.role),
    mustChangePassword: row.mustChangePassword,
    banned: isBanActive(row, now),
    banReason: row.banReason,
    banExpires: row.banExpires?.toISOString() ?? null,
    siteKeys: [...siteKeys],
    createdAt: row.createdAt.toISOString(),
  };
}

/** Users with their assigned site keys, ordered by email. Without `ids`, every user. */
export async function loadUserSummaries(
  executor: Executor,
  now: Date,
  ids?: readonly string[],
): Promise<UserSummary[]> {
  const idFilter = (column: typeof user.id | typeof siteMember.userId) =>
    ids === undefined ? undefined : inArray(column, [...ids]);
  const rows = await executor.select().from(user).where(idFilter(user.id)).orderBy(asc(user.email));
  const memberships = await executor
    .select({ userId: siteMember.userId, key: site.key })
    .from(siteMember)
    .innerJoin(site, eq(site.id, siteMember.siteId))
    .where(idFilter(siteMember.userId))
    .orderBy(asc(site.key));
  const keysByUser = new Map<string, string[]>();
  for (const { userId, key } of memberships) {
    keysByUser.set(userId, [...(keysByUser.get(userId) ?? []), key]);
  }
  return rows.map((row) => toUserSummary(row, keysByUser.get(row.id) ?? [], now));
}

/** Active administrators other than `exceptId`: the ones who would remain. */
export async function countOtherActiveAdmins(
  executor: Executor,
  exceptId: string,
  now: Date,
): Promise<number> {
  const [row] = await executor
    .select({ n: count() })
    .from(user)
    .where(
      and(
        eq(user.role, 'admin'),
        ne(user.id, exceptId),
        or(eq(user.banned, false), and(isNotNull(user.banExpires), lte(user.banExpires, now))),
      ),
    );
  return row?.n ?? 0;
}

const USER_ADMIN_LOCK = sql`select pg_advisory_xact_lock(hashtext('c15t-platform:admin-users'))`;

/** Serializes user mutations, so two admins cannot both remove "the other" last admin. */
export async function lockUserAdministration(tx: Executor): Promise<void> {
  await tx.execute(USER_ADMIN_LOCK);
}
