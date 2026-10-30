// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { auditListQuerySchema } from '@consent/shared';
import { Hono } from 'hono';
import { listAudit } from '../audit.js';
import type { AuthedEnv, Authz } from '../authz.js';
import type { AppDatabase } from '../db.js';
import { validate } from '../validate.js';

/** `GET /api/admin/audit?cursor&limit`: the admin action log, newest first, from the primary. */
export function adminAuditRoutes(deps: {
  db: Pick<AppDatabase, 'primary'>;
  authz: Pick<Authz, 'requireAdmin'>;
}) {
  return new Hono<AuthedEnv>()
    .use('*', deps.authz.requireAdmin)
    .get('/', validate('query', auditListQuerySchema), async (c) =>
      c.json(await listAudit(deps.db.primary, c.req.valid('query'))),
    );
}
