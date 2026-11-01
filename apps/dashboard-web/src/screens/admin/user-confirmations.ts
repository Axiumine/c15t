// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { useResetPassword, useRevokeSessions, useUnbanUser } from '../../api/user-writes';
import type { Pending } from './user-actions';

export type ConfirmMutations = Readonly<{
  reset: ReturnType<typeof useResetPassword>;
  unban: ReturnType<typeof useUnbanUser>;
  revoke: ReturnType<typeof useRevokeSessions>;
}>;

/** The confirmation behind a menu action, or `undefined` for the actions with their own form. */
export function confirmFor(pending: Pending | null, mutations: ConfirmMutations) {
  if (pending === null) return undefined;
  const { kind, user } = pending;
  switch (kind) {
    case 'reset':
      return {
        mutation: mutations.reset,
        title: 'Reset password?',
        description: `A new one-time password is generated for ${user.email}. The old one stops working, all their sessions end, and they must choose a new password at the next sign-in.`,
        label: 'Reset password',
        destructive: true,
        userId: user.id,
      };
    case 'unban':
      return {
        mutation: mutations.unban,
        title: 'Unban user?',
        description: `${user.email} can sign in again.`,
        label: 'Unban',
        destructive: false,
        userId: user.id,
      };
    case 'revoke':
      return {
        mutation: mutations.revoke,
        title: 'Revoke all sessions?',
        description: `${user.email} is signed out on every device. They can sign in again with their password.`,
        label: 'Revoke sessions',
        destructive: true,
        userId: user.id,
      };
    default:
      return undefined;
  }
}
