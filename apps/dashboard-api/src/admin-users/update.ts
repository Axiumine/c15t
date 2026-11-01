// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { user } from '@consent/db';
import type { UserUpdate } from '@consent/shared';
import { type Change, writeAudit } from '../audit.js';
import { lockUserAdministration } from '../users.js';
import type { AdminCall, AdminUserRouteDeps } from './context.js';
import { ensureNotLastAdmin, findUser, summaryOf } from './lookup.js';

/** Fields the request would actually change. Equal values are not changes. */
function diffUser(current: typeof user.$inferSelect, input: UserUpdate): Record<string, Change> {
  const changes: Record<string, Change> = {};
  if (input.name !== undefined && input.name !== current.name) {
    changes['name'] = { from: current.name, to: input.name };
  }
  if (input.role !== undefined && input.role !== current.role) {
    changes['role'] = { from: current.role, to: input.role };
  }
  return changes;
}

/** The name and role fields of the request that differ from the stored user. */
const changedFields = (changes: Record<string, Change>, input: UserUpdate) => ({
  ...(changes['name'] === undefined ? {} : { name: input.name }),
  ...(changes['role'] === undefined ? {} : { role: input.role }),
});

export async function updateAccount(
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
