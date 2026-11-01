// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fieldOf } from '@consent/shared';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';

export function authHooks(): NonNullable<BetterAuthOptions['hooks']> {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- createAuthMiddleware needs a Promise-returning handler, and `async` turns the APIError thrown by changePasswordBody into a rejection
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/change-password') return;
      return changePasswordBody(fieldOf(ctx, 'body'));
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/change-password') return;
      const returned: unknown = ctx.context.returned;
      const userId = changedPasswordUserId(returned);
      if (userId === undefined) return;
      await ctx.context.internalAdapter.updateUser(userId, { mustChangePassword: false });
    }),
  };
}

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
