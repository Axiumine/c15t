// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { adminAudit } from '@consent/db';
import {
  type AuditEntry,
  type AuditPage,
  auditActionSchema,
  auditTargetTypeSchema,
} from '@consent/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { auditCursorSchema } from './audit-cursor.js';
import type { Executor } from './db.js';
import { decodeCursor, encodeCursor, toPage } from './pagination.js';

// Microsecond text, so a cursor never skips rows that share a millisecond.
const createdAtText = sql<string>`to_char(${adminAudit.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function listAudit(
  executor: Executor,
  page: { cursor?: string | undefined; limit: number },
): Promise<AuditPage> {
  const after = decodeCursor(page.cursor, auditCursorSchema);
  const rows = await executor
    .select({
      id: adminAudit.id,
      actorId: adminAudit.actorId,
      actorEmail: adminAudit.actorEmail,
      action: adminAudit.action,
      targetType: adminAudit.targetType,
      targetId: adminAudit.targetId,
      metadata: adminAudit.metadata,
      ip: adminAudit.ip,
      createdAt: createdAtText,
    })
    .from(adminAudit)
    .where(
      after === undefined
        ? undefined
        : or(
            lt(adminAudit.createdAt, sql`${after.t}::timestamptz`),
            and(eq(adminAudit.createdAt, sql`${after.t}::timestamptz`), lt(adminAudit.id, after.i)),
          ),
    )
    .orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
    .limit(page.limit + 1);
  return toPage(
    rows,
    page.limit,
    (row): AuditEntry => ({
      ...row,
      action: auditActionSchema.parse(row.action),
      targetType: auditTargetTypeSchema.parse(row.targetType),
    }),
    (row) => encodeCursor({ t: row.createdAt, i: row.id }),
  );
}
