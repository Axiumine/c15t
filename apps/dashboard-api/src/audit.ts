// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { adminAudit } from '@consent/db';
import type { AuditAction, AuditTargetType } from '@consent/shared';
import type { Executor } from './db.js';

export { listAudit } from './audit-list.js';

export interface AuditActor {
  readonly id: string;
  readonly email: string;
  readonly ip: string | null;
}

export interface AuditInput {
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  /** Never put passwords, hashes or tokens here. */
  readonly metadata?: Record<string, unknown>;
}

/** A field that an admin action changed, as recorded in the audit metadata. */
export type Change = { from: unknown; to: unknown };

/**
 * Appends one `app.admin_audit` row. Always call it with the transaction that holds the change
 * it describes, so both commit or neither does (CLAUDE.md "Authorization").
 */
export async function writeAudit(
  executor: Executor,
  actor: AuditActor | null,
  entry: AuditInput,
): Promise<void> {
  await executor.insert(adminAudit).values({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
    ip: actor?.ip ?? null,
  });
}
