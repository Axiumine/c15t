// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { AuditAction } from '@consent/shared';

export const ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  'site.create': 'Site created',
  'site.update': 'Site updated',
  'site.disable': 'Site disabled',
  'site.enable': 'Site enabled',
  'user.create': 'User created',
  'user.update': 'User updated',
  'user.set-sites': 'Site assignments changed',
  'user.reset-password': 'Password reset',
  'user.ban': 'User banned',
  'user.unban': 'User unbanned',
  'user.revoke-sessions': 'Sessions revoked',
};
