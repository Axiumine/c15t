// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { pageQuerySchema, pageSchema } from './pagination.js';

export const AUDIT_ACTIONS = [
  'site.create',
  'site.update',
  'site.disable',
  'site.enable',
  'user.create',
  'user.update',
  'user.set-sites',
  'user.reset-password',
  'user.ban',
  'user.unban',
  'user.revoke-sessions',
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const AUDIT_TARGET_TYPES = ['site', 'user'] as const;
export const auditTargetTypeSchema = z.enum(AUDIT_TARGET_TYPES);
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;

/** Never store passwords, hashes or tokens in `metadata`. */
export const auditEntrySchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: auditActionSchema,
  targetType: auditTargetTypeSchema,
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** `GET /api/admin/audit?cursor&limit` */
export const auditListQuerySchema = pageQuerySchema;
export const auditPageSchema = pageSchema(auditEntrySchema);
export type AuditPage = z.infer<typeof auditPageSchema>;
