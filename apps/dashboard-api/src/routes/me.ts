// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Me } from '@consent/shared';
import { Hono } from 'hono';
import type { AuthedEnv, Authz } from '../authz.js';

/** `GET /api/me`. The one route that answers while `mustChangePassword` is set. */
export function meRoutes(authz: Pick<Authz, 'requireSessionAllowingPasswordChange'>) {
  return new Hono<AuthedEnv>()
    .use('*', authz.requireSessionAllowingPasswordChange)
    .get('/', (c) => {
      const { id, name, email, role, mustChangePassword } = c.get('user');
      return c.json({ id, name, email, role, mustChangePassword } satisfies Me);
    });
}
