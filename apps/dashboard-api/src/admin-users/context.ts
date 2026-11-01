// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { AuditActor } from '../audit.js';
import { auditActor } from '../audit-actor.js';
import type { Auth } from '../auth.js';
import type { Authz } from '../authz.js';
import type { AuthedEnv } from '../authz-types.js';
import type { AppDatabase } from '../db.js';
import type { RequestContext } from '../errors.js';

export interface AdminUserRouteDeps {
  readonly db: Pick<AppDatabase, 'primary' | 'transaction'>;
  readonly auth: Auth;
  readonly authz: Pick<Authz, 'requireAdmin'>;
  readonly now: () => Date;
}

/** Who is acting, and the request headers that the Better Auth admin calls need. */
export interface AdminCall {
  readonly actor: AuditActor;
  readonly headers: Headers;
}

export const callOf = (c: RequestContext<AuthedEnv>): AdminCall => ({
  actor: auditActor(c),
  headers: c.req.raw.headers,
});
