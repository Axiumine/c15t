// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { BanUserInput } from '@consent/shared';
import { writeAudit } from '../audit.js';
import { HttpError } from '../errors.js';
import { lockUserAdministration } from '../users.js';
import type { AdminCall, AdminUserRouteDeps } from './context.js';
import { ensureNotLastAdmin, findUser, summaryOf } from './lookup.js';

export async function banAccount(
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

export async function unbanAccount(
  deps: AdminUserRouteDeps,
  { actor, headers }: AdminCall,
  id: string,
) {
  await deps.db.transaction(async (tx) => {
    await lockUserAdministration(tx);
    await findUser(tx, id);
    await deps.auth.api.unbanUser({ headers, body: { userId: id } });
    await writeAudit(tx, actor, { action: 'user.unban', targetType: 'user', targetId: id });
  });
  return summaryOf(deps, id);
}
