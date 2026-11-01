// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { site, siteMember, user } from '@consent/db';
import {
  type BanUserInput,
  banUserSchema,
  noNul,
  type OneTimePasswordResult,
  type UserCreate,
  type UserUpdate,
  userCreateSchema,
  userSitesSchema,
  userUpdateSchema,
} from '@consent/shared';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { type AuditActor, auditActor, writeAudit } from '../audit.js';
import type { Auth } from '../auth.js';
import type { AuthedEnv, Authz } from '../authz.js';
import type { AppDatabase, Executor, Transaction } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { generatePassword } from '../password.js';
import {
  countOtherActiveAdmins,
  isBanActive,
  loadUserSummaries,
  lockUserAdministration,
} from '../users.js';
import { validate } from '../validate.js';

export interface AdminUserRouteDeps {
  readonly db: Pick<AppDatabase, 'primary' | 'transaction'>;
  readonly auth: Auth;
  readonly authz: Pick<Authz, 'requireAdmin'>;
  readonly now: () => Date;
}

const idParamSchema = z.object({ id: noNul(z.string().min(1).max(128)) });

type Change = { from: unknown; to: unknown };

/** Fields the request would actually change. Equal values are not changes. */
export function diffUser(
  current: typeof user.$inferSelect,
  input: UserUpdate,
): Record<string, Change> {
  const changes: Record<string, Change> = {};
  if (input.name !== undefined && input.name !== current.name) {
    changes['name'] = { from: current.name, to: input.name };
  }
  if (input.role !== undefined && input.role !== current.role) {
    changes['role'] = { from: current.role, to: input.role };
  }
  return changes;
}

async function findUser(executor: Executor, id: string) {
  const [row] = await executor.select().from(user).where(eq(user.id, id)).limit(1);
  if (row === undefined) throw notFound('User not found');
  return row;
}

/** Site IDs for `siteKeys`. Unknown keys are a validation error, not a silent skip. */
async function resolveSiteIds(executor: Executor, siteKeys: readonly string[]) {
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
const byCodeUnit = (a: string, b: string): number => Number(a > b) - Number(a < b);

/** Who is acting, and the request headers that the Better Auth admin calls need. */
interface AdminCall {
  readonly actor: AuditActor;
  readonly headers: Headers;
}

const callOf = (c: Context<AuthedEnv>): AdminCall => ({
  actor: auditActor(c),
  headers: c.req.raw.headers,
});

/** Refuses to demote or ban the only active administrator. */
async function ensureNotLastAdmin(
  tx: Transaction,
  target: typeof user.$inferSelect,
  now: () => Date,
) {
  if (target.role !== 'admin' || isBanActive(target, now())) return;
  if ((await countOtherActiveAdmins(tx, target.id, now())) === 0) {
    throw new HttpError('LAST_ADMIN', 'At least one active administrator must remain');
  }
}

async function summaryOf({ db, now }: AdminUserRouteDeps, id: string) {
  const [summary] = await loadUserSummaries(db.primary, now(), [id]);
  if (summary === undefined) throw notFound('User not found');
  return summary;
}

/** Creates the account, its site memberships and the audit row, with a one-time password. */
async function createAccount(
  deps: AdminUserRouteDeps,
  { actor, headers }: AdminCall,
  input: UserCreate,
): Promise<OneTimePasswordResult> {
  const { db, auth } = deps;
  const password = generatePassword();
  const created = await db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    const sites = await resolveSiteIds(tx, input.siteKeys);
    const [existing] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, input.email))
      .limit(1);
    if (existing !== undefined)
      throw new HttpError('EMAIL_TAKEN', 'A user with this email already exists');

    const result = await auth.api.createUser({
      headers,
      body: {
        email: input.email,
        name: input.name,
        password,
        role: input.role,
        data: { mustChangePassword: true },
      },
    });
    if (sites.length > 0) {
      await tx
        .insert(siteMember)
        .values(sites.map((row) => ({ userId: result.user.id, siteId: row.id })));
    }
    await writeAudit(tx, actor, {
      action: 'user.create',
      targetType: 'user',
      targetId: result.user.id,
      metadata: {
        email: input.email,
        role: input.role,
        siteKeys: [...input.siteKeys].sort(byCodeUnit),
      },
    });
    return result.user.id;
  });
  return { user: await summaryOf(deps, created), oneTimePassword: password };
}

/** The name and role fields of the request that differ from the stored user. */
const changedFields = (changes: Record<string, Change>, input: UserUpdate) => ({
  ...(changes['name'] === undefined ? {} : { name: input.name }),
  ...(changes['role'] === undefined ? {} : { role: input.role }),
});

async function updateAccount(
  deps: AdminUserRouteDeps,
  { actor, headers }: AdminCall,
  id: string,
  input: UserUpdate,
) {
  const { db, auth, now } = deps;
  await db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    const current = await findUser(tx, id);
    const changes = diffUser(current, input);
    if (changes['role'] !== undefined && input.role !== 'admin') {
      await ensureNotLastAdmin(tx, current, now);
    }
    if (Object.keys(changes).length === 0) return;
    await auth.api.adminUpdateUser({
      headers,
      body: {
        userId: id,
        data: changedFields(changes, input),
      },
    });
    await writeAudit(tx, actor, {
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      metadata: { changes },
    });
  });
  return summaryOf(deps, id);
}

/** Deletes every membership of the user except the sites in `keepIds` (none kept: all). */
function removeMembershipsOutside(tx: Transaction, userId: string, keepIds: readonly string[]) {
  const outside = keepIds.length === 0 ? undefined : notInArray(siteMember.siteId, [...keepIds]);
  return tx.delete(siteMember).where(and(eq(siteMember.userId, userId), outside));
}

/** Replaces the user's site memberships. A request that changes nothing writes nothing. */
async function replaceMemberships(
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
    if (toAdd.length > 0) {
      await tx.insert(siteMember).values(toAdd.map((row) => ({ userId: id, siteId: row.id })));
    }
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

/** Sets a new one-time password, forces a change at the next sign-in and ends all sessions. */
async function resetAccountPassword(
  deps: AdminUserRouteDeps,
  { actor, headers }: AdminCall,
  id: string,
): Promise<OneTimePasswordResult> {
  const { db, auth } = deps;
  if (id === actor.id) {
    throw new HttpError('BAD_REQUEST', 'Change your own password from your account page');
  }
  const password = generatePassword();
  await db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    await findUser(tx, id);
    await auth.api.setUserPassword({ headers, body: { userId: id, newPassword: password } });
    await tx.update(user).set({ mustChangePassword: true }).where(eq(user.id, id));
    await auth.api.revokeUserSessions({ headers, body: { userId: id } });
    await writeAudit(tx, actor, {
      action: 'user.reset-password',
      targetType: 'user',
      targetId: id,
      metadata: { sessionsRevoked: true },
    });
  });
  return { user: await summaryOf(deps, id), oneTimePassword: password };
}

async function banAccount(
  deps: AdminUserRouteDeps,
  { actor, headers }: AdminCall,
  id: string,
  input: BanUserInput,
) {
  const { db, auth, now } = deps;
  if (id === actor.id) throw new HttpError('BAD_REQUEST', 'You cannot ban yourself');
  await db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    const target = await findUser(tx, id);
    await ensureNotLastAdmin(tx, target, now);
    await auth.api.banUser({
      headers,
      body: {
        userId: id,
        ...(input.reason === undefined ? {} : { banReason: input.reason }),
        ...(input.expiresInSeconds === undefined ? {} : { banExpiresIn: input.expiresInSeconds }),
      },
    });
    await writeAudit(tx, actor, {
      action: 'user.ban',
      targetType: 'user',
      targetId: id,
      metadata: {
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: input.expiresInSeconds }),
      },
    });
  });
  return summaryOf(deps, id);
}

async function unbanAccount(deps: AdminUserRouteDeps, { actor, headers }: AdminCall, id: string) {
  await deps.db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    await findUser(tx, id);
    await deps.auth.api.unbanUser({ headers, body: { userId: id } });
    await writeAudit(tx, actor, { action: 'user.unban', targetType: 'user', targetId: id });
  });
  return summaryOf(deps, id);
}

function revokeAccountSessions(
  { db, auth }: AdminUserRouteDeps,
  { actor, headers }: AdminCall,
  id: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    await findUser(tx, id);
    await auth.api.revokeUserSessions({ headers, body: { userId: id } });
    await writeAudit(tx, actor, {
      action: 'user.revoke-sessions',
      targetType: 'user',
      targetId: id,
    });
  });
}

/**
 * Admin user management. Every mutation runs in one primary transaction that also holds the
 * Better Auth calls (`db.authDb` resolves to the open transaction) and the audit row, so a
 * failure anywhere rolls the whole action back. The one-time password only ever exists in the
 * response body: it is not stored, logged or audited.
 */
export function adminUserRoutes(deps: AdminUserRouteDeps) {
  const { db, authz, now } = deps;
  return new Hono<AuthedEnv>()
    .use('*', authz.requireAdmin)
    .get('/', async (c) => c.json({ items: await loadUserSummaries(db.primary, now()) }))
    .post('/', validate('json', userCreateSchema), async (c) =>
      c.json(await createAccount(deps, callOf(c), c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      validate('param', idParamSchema),
      validate('json', userUpdateSchema),
      async (c) =>
        c.json(await updateAccount(deps, callOf(c), c.req.valid('param').id, c.req.valid('json'))),
    )
    .put(
      '/:id/sites',
      validate('param', idParamSchema),
      validate('json', userSitesSchema),
      async (c) =>
        c.json(
          await replaceMemberships(
            deps,
            callOf(c),
            c.req.valid('param').id,
            c.req.valid('json').siteKeys,
          ),
        ),
    )
    .post('/:id/reset-password', validate('param', idParamSchema), async (c) =>
      c.json(await resetAccountPassword(deps, callOf(c), c.req.valid('param').id)),
    )
    .post(
      '/:id/ban',
      validate('param', idParamSchema),
      validate('json', banUserSchema),
      async (c) =>
        c.json(await banAccount(deps, callOf(c), c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/:id/unban', validate('param', idParamSchema), async (c) =>
      c.json(await unbanAccount(deps, callOf(c), c.req.valid('param').id)),
    )
    .post('/:id/revoke-sessions', validate('param', idParamSchema), async (c) => {
      await revokeAccountSessions(deps, callOf(c), c.req.valid('param').id);
      return c.json({ ok: true as const });
    });
}
