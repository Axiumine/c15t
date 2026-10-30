// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { adminAudit } from '@consent/db';
import {
  type AuditAction,
  type AuditEntry,
  type AuditPage,
  type AuditTargetType,
  auditActionSchema,
  auditTargetTypeSchema,
  isRepresentableInstant,
  parseIp,
} from '@consent/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AuthedEnv } from './authz.js';
import type { Executor } from './db.js';
import { decodeCursor, encodeCursor, toPage } from './pagination.js';

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

/** First entry of `X-Forwarded-For`, which nginx sets to the real visitor address. */
export function clientIp(headers: Headers): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first !== undefined && parseIp(first) !== null ? first : null;
}

/** The signed-in admin behind a request, as recorded in the audit log. */
export function auditActor(c: Context<AuthedEnv>): AuditActor {
  const { id, email } = c.get('user');
  return { id, email, ip: clientIp(c.req.raw.headers) };
}

// Microsecond text, so a cursor never skips rows that share a millisecond.
const createdAtText = sql<string>`to_char(${adminAudit.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** A real instant in years 0001-9999: `2026-02-31` and year 0000 pass the zod shape check only. */
function isRealInstant(value: string): boolean {
  const ms = Date.parse(value);
  const day = value.slice(0, 10);
  return isRepresentableInstant(ms) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
}

const auditCursorSchema = z.object({
  t: z.iso.datetime({ offset: true }).refine(isRealInstant, 'Not a timestamp'),
  i: z.uuid(),
});

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
