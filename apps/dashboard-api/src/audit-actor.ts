// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { parseIp } from '@consent/shared';
import type { AuditActor } from './audit.js';
import type { AuthedEnv } from './authz-types.js';
import type { RequestContext } from './errors.js';

/** First entry of `X-Forwarded-For`, which nginx sets to the real visitor address. */
export function clientIp(headers: Headers): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first !== undefined && parseIp(first) !== null ? first : null;
}

/** The signed-in admin behind a request, as recorded in the audit log. */
export function auditActor(c: RequestContext<AuthedEnv>): AuditActor {
  const { id, email } = c.get('user');
  return { id, email, ip: clientIp(c.req.raw.headers) };
}
