// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { authSchema } from '@consent/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { authHooks } from './auth-hooks.js';
import {
  advancedOptions,
  authLogger,
  RATE_LIMIT_OPTIONS,
  SESSION_OPTIONS,
} from './auth-options.js';
import type { AppDatabase } from './db.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';

export const AUTH_BASE_PATH = '/api/auth';

export interface AuthOptions {
  readonly db: Pick<AppDatabase, 'authDb'>;
  readonly env: Pick<Env, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>;
  readonly logger: Logger;
}

/**
 * Better Auth with the admin plugin, on the `app` schema. Verified against better-auth 1.7.x:
 * - `mustChangePassword` has `input: false`, so no HTTP caller can clear it. The after-hook
 *   (auth-hooks.ts) clears it when `/change-password` succeeds. The before-hook runs first: it
 *   rejects a "change" to the same password (the one-time password must be replaced, whatever the
 *   client sends) and forces `revokeOtherSessions`, so a leaked one-time password cannot keep a
 *   session.
 * - Sign-up is disabled. Admins create users through `auth.api.createUser` (admin-users/create.ts).
 * - The HTTP surface is narrowed to four routes in auth-endpoints.ts, so the admin plugin's own
 *   endpoints (which would skip our audit log) are never reachable from a browser.
 */
export function createAuth({ db, env, logger }: AuthOptions) {
  const secure = new URL(env.BETTER_AUTH_URL).protocol === 'https:';
  return betterAuth({
    appName: 'c15t dashboard',
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db.authDb, { provider: 'pg', schema: authSchema }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        mustChangePassword: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: SESSION_OPTIONS,
    rateLimit: RATE_LIMIT_OPTIONS,
    advanced: advancedOptions(secure),
    logger: authLogger(logger),
    plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
    hooks: authHooks(),
  });
}

export type Auth = ReturnType<typeof createAuth>;
