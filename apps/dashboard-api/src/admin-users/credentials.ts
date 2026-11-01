// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { user } from '@consent/db';
import type { OneTimePasswordResult } from '@consent/shared';
import { eq } from 'drizzle-orm';
import { writeAudit } from '../audit.js';
import { HttpError } from '../errors.js';
import { generatePassword } from '../password.js';
import { lockUserAdministration } from '../users.js';
import type { AdminCall, AdminUserRouteDeps } from './context.js';
import { findUser, summaryOf } from './lookup.js';

/** Sets a new one-time password, forces a change at the next sign-in and ends all sessions. */
export async function resetAccountPassword(
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

export function revokeAccountSessions(
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
