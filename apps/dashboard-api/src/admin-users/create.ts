// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { user } from '@consent/db';
import type { OneTimePasswordResult, UserCreate } from '@consent/shared';
import { eq } from 'drizzle-orm';
import { writeAudit } from '../audit.js';
import { HttpError } from '../errors.js';
import { generatePassword } from '../password.js';
import { lockUserAdministration } from '../users.js';
import type { AdminCall, AdminUserRouteDeps } from './context.js';
import { byCodeUnit, resolveSiteIds, summaryOf } from './lookup.js';
import { addMemberships } from './memberships.js';

/** Creates the account, its site memberships and the audit row, with a one-time password. */
export async function createAccount(
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
    await addMemberships(tx, result.user.id, sites);
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
