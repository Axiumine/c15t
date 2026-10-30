// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { site, siteMember, user } from '@consent/db';
import {
  banUserSchema,
  noNul,
  type OneTimePasswordResult,
  type UserUpdate,
  userCreateSchema,
  userSitesSchema,
  userUpdateSchema,
} from '@consent/shared';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditActor, writeAudit } from '../audit.js';
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

/**
 * Admin user management. Every mutation runs in one primary transaction that also holds the
 * Better Auth calls (`db.authDb` resolves to the open transaction) and the audit row, so a
 * failure anywhere rolls the whole action back. The one-time password only ever exists in the
 * response body: it is not stored, logged or audited.
 */
export function adminUserRoutes({ db, auth, authz, now }: AdminUserRouteDeps) {
  /** Refuses to demote or ban the only active administrator. */
  async function ensureNotLastAdmin(tx: Transaction, target: typeof user.$inferSelect) {
    if (target.role !== 'admin' || isBanActive(target, now())) return;
    if ((await countOtherActiveAdmins(tx, target.id, now())) === 0) {
      throw new HttpError('LAST_ADMIN', 'At least one active administrator must remain');
    }
  }

  async function summaryOf(id: string) {
    const [summary] = await loadUserSummaries(db.primary, now(), [id]);
    if (summary === undefined) throw notFound('User not found');
    return summary;
  }

  return new Hono<AuthedEnv>()
    .use('*', authz.requireAdmin)
    .get('/', async (c) => c.json({ items: await loadUserSummaries(db.primary, now()) }))
    .post('/', validate('json', userCreateSchema), async (c) => {
      const input = c.req.valid('json');
      const actor = auditActor(c);
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
          headers: c.req.raw.headers,
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
          metadata: { email: input.email, role: input.role, siteKeys: [...input.siteKeys].sort() },
        });
        return result.user.id;
      });
      const body: OneTimePasswordResult = {
        user: await summaryOf(created),
        oneTimePassword: password,
      };
      return c.json(body, 201);
    })
    .patch(
      '/:id',
      validate('param', idParamSchema),
      validate('json', userUpdateSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const input = c.req.valid('json');
        const actor = auditActor(c);
        await db.transaction(async (tx) => {
          await lockUserAdministration(tx);
          const current = await findUser(tx, id);
          const changes = diffUser(current, input);
          if (changes['role'] !== undefined && input.role !== 'admin') {
            await ensureNotLastAdmin(tx, current);
          }
          if (Object.keys(changes).length === 0) return;
          await auth.api.adminUpdateUser({
            headers: c.req.raw.headers,
            body: {
              userId: id,
              data: {
                ...(changes['name'] === undefined ? {} : { name: input.name }),
                ...(changes['role'] === undefined ? {} : { role: input.role }),
              },
            },
          });
          await writeAudit(tx, actor, {
            action: 'user.update',
            targetType: 'user',
            targetId: id,
            metadata: { changes },
          });
        });
        return c.json(await summaryOf(id));
      },
    )
    .put(
      '/:id/sites',
      validate('param', idParamSchema),
      validate('json', userSitesSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const { siteKeys } = c.req.valid('json');
        const actor = auditActor(c);
        await db.transaction(async (tx) => {
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

          if (toRemove.length > 0) {
            await tx
              .delete(siteMember)
              .where(
                and(
                  eq(siteMember.userId, id),
                  wantedIds.length === 0 ? undefined : notInArray(siteMember.siteId, wantedIds),
                ),
              );
          }
          if (toAdd.length > 0) {
            await tx
              .insert(siteMember)
              .values(toAdd.map((row) => ({ userId: id, siteId: row.id })));
          }
          await writeAudit(tx, actor, {
            action: 'user.set-sites',
            targetType: 'user',
            targetId: id,
            metadata: {
              before: before.map((row) => row.key).sort(),
              after: wanted.map((row) => row.key).sort(),
            },
          });
        });
        return c.json(await summaryOf(id));
      },
    )
    .post('/:id/reset-password', validate('param', idParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const actor = auditActor(c);
      if (id === actor.id) {
        throw new HttpError('BAD_REQUEST', 'Change your own password from your account page');
      }
      const password = generatePassword();
      await db.transaction(async (tx) => {
        await lockUserAdministration(tx);
        await findUser(tx, id);
        await auth.api.setUserPassword({
          headers: c.req.raw.headers,
          body: { userId: id, newPassword: password },
        });
        await tx.update(user).set({ mustChangePassword: true }).where(eq(user.id, id));
        await auth.api.revokeUserSessions({ headers: c.req.raw.headers, body: { userId: id } });
        await writeAudit(tx, actor, {
          action: 'user.reset-password',
          targetType: 'user',
          targetId: id,
          metadata: { sessionsRevoked: true },
        });
      });
      const body: OneTimePasswordResult = { user: await summaryOf(id), oneTimePassword: password };
      return c.json(body);
    })
    .post(
      '/:id/ban',
      validate('param', idParamSchema),
      validate('json', banUserSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const input = c.req.valid('json');
        const actor = auditActor(c);
        if (id === actor.id) throw new HttpError('BAD_REQUEST', 'You cannot ban yourself');
        await db.transaction(async (tx) => {
          await lockUserAdministration(tx);
          const target = await findUser(tx, id);
          await ensureNotLastAdmin(tx, target);
          await auth.api.banUser({
            headers: c.req.raw.headers,
            body: {
              userId: id,
              ...(input.reason === undefined ? {} : { banReason: input.reason }),
              ...(input.expiresInSeconds === undefined
                ? {}
                : { banExpiresIn: input.expiresInSeconds }),
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
        return c.json(await summaryOf(id));
      },
    )
    .post('/:id/unban', validate('param', idParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const actor = auditActor(c);
      await db.transaction(async (tx) => {
        await lockUserAdministration(tx);
        await findUser(tx, id);
        await auth.api.unbanUser({ headers: c.req.raw.headers, body: { userId: id } });
        await writeAudit(tx, actor, { action: 'user.unban', targetType: 'user', targetId: id });
      });
      return c.json(await summaryOf(id));
    })
    .post('/:id/revoke-sessions', validate('param', idParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const actor = auditActor(c);
      await db.transaction(async (tx) => {
        await lockUserAdministration(tx);
        await findUser(tx, id);
        await auth.api.revokeUserSessions({ headers: c.req.raw.headers, body: { userId: id } });
        await writeAudit(tx, actor, {
          action: 'user.revoke-sessions',
          targetType: 'user',
          targetId: id,
        });
      });
      return c.json({ ok: true as const });
    });
}
