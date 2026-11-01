// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { AUTH_BASE_PATH, type Auth } from './auth.js';
import { errorResponse } from './error-response.js';
import type { RequestContext } from './errors.js';

/**
 * The only Better Auth routes a browser may reach. The admin plugin's own HTTP endpoints stay
 * closed: they would let an admin skip the audit log and the last-admin rule. Our
 * `/api/admin/*` routes call them server-side instead.
 */
const AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  'POST /sign-in/email',
  'POST /sign-out',
  'GET /get-session',
  'POST /change-password',
]);

export const authEndpointHandler = (auth: Auth) => (c: RequestContext) => {
  const endpoint = c.req.path.slice(AUTH_BASE_PATH.length);
  if (!AUTH_ENDPOINTS.has(`${c.req.method} ${endpoint}`)) return errorResponse(c, 'NOT_FOUND');
  return auth.handler(c.req.raw);
};
