// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  banUserSchema,
  noNul,
  userCreateSchema,
  userSitesSchema,
  userUpdateSchema,
} from '@consent/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { banAccount, unbanAccount } from '../admin-users/ban.js';
import { type AdminUserRouteDeps, callOf } from '../admin-users/context.js';
import { createAccount } from '../admin-users/create.js';
import { resetAccountPassword, revokeAccountSessions } from '../admin-users/credentials.js';
import { replaceMemberships } from '../admin-users/memberships.js';
import { updateAccount } from '../admin-users/update.js';
import type { AuthedEnv } from '../authz.js';
import { loadUserSummaries } from '../users.js';
import { validate } from '../validate.js';

const idParamSchema = z.object({ id: noNul(z.string().min(1).max(128)) });

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
