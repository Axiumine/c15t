// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { authSchema } from '@consent/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import type { AppDatabase } from './db.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';

export const AUTH_BASE_PATH = '/api/auth';

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
const SESSION_REFRESH_SECONDS = 60 * 60 * 24;

/** Failed logins per client IP: 10 in five minutes (README "Security notes"). */
const LOGIN_RATE_LIMIT = { window: 300, max: 10 } as const;
const PASSWORD_RATE_LIMIT = { window: 300, max: 10 } as const;
const DEFAULT_RATE_LIMIT = { window: 60, max: 120 } as const;

export interface AuthOptions {
  readonly db: Pick<AppDatabase, 'authDb'>;
  readonly env: Pick<Env, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>;
  readonly logger: Logger;
}

/**
 * Better Auth with the admin plugin, on the `app` schema. Verified against better-auth 1.7.x:
 * - `mustChangePassword` has `input: false`, so no HTTP caller can clear it. The after-hook
 *   below clears it when `/change-password` succeeds. The before-hook runs first: it rejects a
 *   "change" to the same password (the one-time password must be replaced, whatever the client
 *   sends) and forces `revokeOtherSessions`, so a leaked one-time password cannot keep a session.
 * - Sign-up is disabled. Admins create users through `auth.api.createUser` (routes/admin-users).
 * - The HTTP surface is narrowed to four routes in app.ts, so the admin plugin's own endpoints
 *   (which would skip our audit log) are never reachable from a browser.
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
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      // No cookie cache: a ban, a revoked session or a role change takes effect on the next request.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      ...DEFAULT_RATE_LIMIT,
      customRules: {
        '/sign-in/email': LOGIN_RATE_LIMIT,
        '/change-password': PASSWORD_RATE_LIMIT,
      },
    },
    advanced: {
      cookiePrefix: 'c15t-dashboard',
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure },
      // nginx sets X-Forwarded-For from the real visitor IP (CLAUDE.md "Credentials").
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    logger: {
      level: 'warn',
      log: (level, message) => {
        // First line only, like `describeError`: a stack or SQL parameters may follow it.
        const line = message.replace(/\n[\s\S]*$/, '').slice(0, 300);
        if (level === 'error') logger.error('better-auth', { detail: line });
        else if (level === 'warn') logger.warn('better-auth', { detail: line });
      },
    },
    plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/change-password') return;
        return changePasswordBody(ctx.body);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/change-password') return;
        const returned: unknown = ctx.context.returned;
        const userId = changedPasswordUserId(returned);
        if (userId === undefined) return;
        await ctx.context.internalAdapter.updateUser(userId, { mustChangePassword: false });
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The before-hook result for `/change-password`: the same body with `revokeOtherSessions` forced
 * to true, or a 400 when the new password equals the current one. A body that is not an object
 * of strings is left to Better Auth's own validation.
 */
export function changePasswordBody(
  body: unknown,
): { context: { body: Record<string, unknown> } } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const fields = body as { newPassword?: unknown; currentPassword?: unknown };
  if (fields.newPassword === fields.currentPassword && typeof fields.newPassword === 'string') {
    throw APIError.from('BAD_REQUEST', {
      code: 'PASSWORD_UNCHANGED',
      message: 'The new password must differ from the current one',
    });
  }
  return { context: { body: { ...body, revokeOtherSessions: true } } };
}

/** The id from the `{ token, user }` body of a successful `/change-password`. */
export function changedPasswordUserId(returned: unknown): string | undefined {
  if (typeof returned !== 'object' || returned === null) return undefined;
  const user = (returned as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null) return undefined;
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}
